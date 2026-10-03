#!/usr/bin/env bash
set -euo pipefail

# Rebuild Messenger when the first HushMessenger patch attempt rejects the
# downloaded APK's version code. HushMessenger only accepts specific unmodified
# arm64 version codes for each release; this script parses the supported codes
# from the failure log, downloads an APK with exactly that code, and retries.
#
# Variant availability (verified 2026-09-30): for Messenger 580.0.0.49.91,
# APKPure's mobile catalog API (api.pureapk.com) lists variants 346013445,
# 346013442, 346013438, 346013434 and 346013421. apkeep only downloads the
# first variant (346013445, not accepted by HushMessenger), so the exact-code
# loop uses scripts/apkpure_api_download.py to pick an accepted variant code
# straight from the same catalog. apkpure.com website mirrors stay
# Cloudflare/IP-blocked from GitHub runners; if APKPure drops the accepted
# variants or the patcher rejects the download, set MESSENGER_APK_URL to a
# manually obtained stock arm64 APK with an accepted version code.

build_log=".cache/hushmessenger-build.log"
mkdir -p .cache

set +e
node scripts/hushfacebook-builder.mjs build 2>&1 | tee "$build_log"
build_status=${PIPESTATUS[0]}
set -e

if [ "$build_status" -eq 0 ]; then
  exit 0
fi

supported_version_codes="$(node -e '
  const fs = require("node:fs");
  let output = "";
  try { output = fs.readFileSync(process.argv[1], "utf8"); } catch {}
  const guidance = output.match(/Use an unmodified arm64 Messenger\b([^\r\n]*)/i)?.[1] || "";
  const codeClause = guidance.match(/version codes?\s+([^)]*)/i)?.[1] || "";
  if (guidance && codeClause) {
    const codes = [...codeClause.matchAll(/\d{7,}/g)].map(([code]) => code);
    const version = guidance.match(/^\s*([\d]+(?:\.[\d]+)+)\s+APK/i)?.[1] || "";
    if (codes.length && version) {
      process.stdout.write(JSON.stringify({ codes: [...new Set(codes)], version }));
      process.exit(0);
    }
  }

  // Fallback: extract supported version codes directly from HushMessenger patch catalog
  let patchesTag = process.env.HUSHMESSENGER_PATCHES_VERSION || "v0.8.0";
  try {
    const meta = JSON.parse(fs.readFileSync(".cache/tools/patches-messenger.json", "utf8"));
    patchesTag = meta.tag || patchesTag;
  } catch {}

  (async () => {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/SysAdminDoc/HushMessenger/${patchesTag}/patches-list.json`);
      if (res.ok) {
        const data = await res.json();
        const patches = data.patches || (Array.isArray(data) ? data : []);
        for (const p of patches) {
          for (const cp of (p.compatiblePackages || [])) {
            if (cp.packageName === "com.facebook.orca") {
              for (const t of (cp.targets || [])) {
                const desc = t.description || "";
                const codes = [...desc.matchAll(/\d{7,}/g)].map(([code]) => code);
                if (codes.length && t.version) {
                  // Put 346013442 first as it is verified in APKPure mobile catalog
                  const prioritized = ["346013442", ...new Set(codes.filter(c => c !== "346013442"))];
                  process.stdout.write(JSON.stringify({ codes: prioritized, version: t.version }));
                  return;
                }
              }
            }
          }
        }
      }
    } catch {}

    const fallbackCodes = ["346013442", "346013445", "346013438", "346013434", "346013421", "346013440", "346013441", "346013443", "346013444"];
    process.stdout.write(JSON.stringify({ codes: fallbackCodes, version: "580.0.0.49.91" }));
  })();
' "$build_log")"

if [ -z "$supported_version_codes" ]; then
  echo "Messenger build failed and HushMessenger did not report alternate supported APK version codes."
  exit "$build_status"
fi

compatible_version="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).version)' "$supported_version_codes")"
version_codes="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).codes.join(" "))' "$supported_version_codes")"
if [ -z "$compatible_version" ] || [ -z "$version_codes" ]; then
  echo "Messenger build failed and HushMessenger did not report a usable version and APK version code."
  exit "$build_status"
fi

clear_messenger_outputs() {
  rm -f output/messenger-patched.apk output/messenger-*-patched.apk output/messenger-result.json
}

try_patch_downloaded_apk() {
  local apk_path="$1" log_name="$2"
  clear_messenger_outputs
  local retry_status
  set +e
  MESSENGER_APK="$apk_path" node scripts/hushfacebook-builder.mjs build 2>&1 | tee ".cache/hushmessenger-build-$log_name.log"
  retry_status=${PIPESTATUS[0]}
  set -e
  return "$retry_status"
}

for version_code in $version_codes; do
  echo "Trying APKPure mobile catalog API for Messenger $compatible_version (code $version_code)..."
  download_result=""
  api_dir=".cache/hushmessenger-apkpure-api-$version_code"
  rm -rf "$api_dir"
  mkdir -p "$api_dir"
  if download_result="$(python scripts/apkpure_api_download.py \
    --app-name Messenger \
    --package-name com.facebook.orca \
    --out-dir "$api_dir" \
    --version "$compatible_version" \
    --version-code "$version_code" \
    --expect-arch arm64-v8a 2>/dev/null)"; then
    : # Success via APKPure mobile catalog API
  else
    echo "APKPure catalog API could not provide version code $version_code; trying APKMirror..."
    download_result=""
    if download_result="$(python scripts/apkmirror_download.py \
      --app-name Messenger \
      --package-name com.facebook.orca \
      --org facebook-2 \
      --repo messenger \
      --slug messenger \
      --out-dir ".cache/hushmessenger-apkmirror-$version_code" \
      --version "$compatible_version" \
      --version-code "$version_code" \
      --arch arm64-v8a \
      --dpi any \
      --type apk 2>/dev/null)"; then
      :
    elif download_result="$(python scripts/apkpure_download.py \
      --app-name Messenger \
      --package-name com.facebook.orca \
      --source-page https://apkpure.com/messenger/com.facebook.orca \
      --out-dir ".cache/hushmessenger-apkpure-$version_code" \
      --version "$compatible_version" \
      --version-code "$version_code" 2>/dev/null)"; then
      :
    else
      apkeep_dir=".cache/hushmessenger-apkeep-exact-$version_code"
      rm -rf "$apkeep_dir"
      mkdir -p "$apkeep_dir"
      apkeep_bin=".cache/tools/apkeep"
      apkeep_apk=""
      if [ -x "$apkeep_bin" ] && "$apkeep_bin" -a "com.facebook.orca@$compatible_version" -d apk-pure -o 'acknowledge_dangers=true' "$apkeep_dir" 2>/dev/null; then
        apkeep_apk="$(find "$apkeep_dir" -maxdepth 2 -type f \( -iname '*.apk' -o -iname '*.xapk' \) -print -quit)"
      fi
      if [ -n "$apkeep_apk" ]; then
        download_result="$(node -e 'process.stdout.write(JSON.stringify({ path: process.argv[1], versionCode: "" }))' "$apkeep_apk")"
      else
        echo "No source could download Messenger version code $version_code; trying the next supported variant."
        continue
      fi
    fi
  fi
  downloaded_code="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).versionCode || ""))' "$download_result")"
  apk_path="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).path)' "$download_result")"
  if [ ! -f "$apk_path" ]; then
    echo "Downloaded Messenger file is missing: $apk_path. Skipping this version code."
    continue
  fi
  if [ -n "$downloaded_code" ] && [ "$downloaded_code" != "$version_code" ]; then
    echo "Downloaded Messenger metadata says version code $downloaded_code; expected $version_code. Skipping this file."
    continue
  fi

  if try_patch_downloaded_apk "$apk_path" "$version_code"; then
    exit 0
  fi
done

apkcombo_dir=".cache/hushmessenger-apkcombo"
rm -rf "$apkcombo_dir"
mkdir -p "$apkcombo_dir"
echo "Trying APKCombo for exact Messenger version $compatible_version and arm64-v8a."
if npm install --no-save --ignore-scripts @nirewen/apkcombo-downloader@1.0.3; then
  if apkcombo_result="$(node scripts/apkcombo_download.mjs "$compatible_version" "$apkcombo_dir")"; then
    apkcombo_apk="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).path)' "$apkcombo_result")"
    if [ -f "$apkcombo_apk" ]; then
      if try_patch_downloaded_apk "$apkcombo_apk" "apkcombo"; then
        exit 0
      fi
      echo "APKCombo arm64 variant was rejected by HushMessenger or failed to patch; it will not be published."
    else
      echo "APKCombo reported a Messenger APK path that does not exist: $apkcombo_apk"
    fi
  else
    echo "APKCombo could not download Messenger $compatible_version for arm64-v8a."
  fi
else
  echo "Could not install the pinned APKCombo downloader; continuing to the APKPure/apkeep fallback."
fi

apkeep_bin=".cache/tools/apkeep"
if [ -x "$apkeep_bin" ]; then
  apkeep_dir=".cache/hushmessenger-apkeep-arm64"
  rm -rf "$apkeep_dir"
  mkdir -p "$apkeep_dir"
  echo "Trying APKPure through apkeep with an arm64-v8a-only variant filter for Messenger $compatible_version."
  if "$apkeep_bin" -a "com.facebook.orca@$compatible_version" -d apk-pure -o 'acknowledge_dangers=true' -o 'arch=arm64-v8a' "$apkeep_dir"; then
    apkeep_apk="$(find "$apkeep_dir" -maxdepth 2 -type f -iname '*.apk' -print -quit)"
    if [ -n "$apkeep_apk" ]; then
      if try_patch_downloaded_apk "$apkeep_apk" "apkeep-arm64"; then
        exit 0
      fi
      echo "APKPure/apkeep arm64 variant was rejected by HushMessenger or failed to patch; it will not be published."
    else
      echo "APKPure/apkeep returned successfully but did not produce an APK file."
    fi
  else
    echo "APKPure/apkeep could not download an arm64-v8a Messenger APK."
  fi
else
  echo "APKPure/apkeep arm64 fallback is unavailable: $apkeep_bin was not created by the initial Morphe attempt."
fi

echo "Messenger build failed for every exact version code HushMessenger reported. No name-only fallback APK will be patched or published."
echo "HushMessenger $compatible_version accepts arm64 version codes: $version_codes."
echo "APKPure's mobile catalog and APKMirror/APKCombo website mirrors carried no acceptable variant for this version; MESSENGER_APK_URL is the remaining workaround."
echo "Workaround: download a stock arm64 Messenger $compatible_version build with one of the accepted version codes manually, upload it to a private URL, and set the messenger_apk_url workflow input to it."
exit 1
