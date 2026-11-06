#!/usr/bin/env bash
set -euo pipefail

# Rebuild Facebook when the downloaded APK does not match the exact variant
# versionCode expected by HushFacebook. Meta builds Facebook with Redex; each
# variant/ABI pass has entirely distinct obfuscated bytecode and class layouts.
# HushFacebook fingerprints strictly target specific unmodified arm64 version
# codes (for 585.0.0.47.54: versionCode 476015655).

build_log=".cache/hushfacebook-build.log"
mkdir -p .cache

clear_facebook_outputs() {
  rm -f output/facebook-patched.apk output/facebook-*-patched.apk output/facebook-result.json
  rm -f input/facebook.apk input/facebook.apk.meta.json input/facebook.xapk input/facebook.xapk.meta.json input/facebook.apkm input/facebook.apkm.meta.json
}

is_facebook_patch_successful() {
  local log_file="${1:-$build_log}"
  if [ -f "$log_file" ] && grep -qi "version code .* is not supported" "$log_file"; then
    echo "Patcher logged unsupported version code."
    return 1
  fi
  if [ ! -f "output/facebook-result.json" ]; then
    echo "output/facebook-result.json is missing."
    return 1
  fi
  local is_ok
  is_ok="$(node -e '
    try {
      const fs = require("node:fs");
      const r = JSON.parse(fs.readFileSync("output/facebook-result.json", "utf8"));
      if (r.success === false) { process.stdout.write("false"); process.exit(0); }
      const applied = Array.isArray(r.appliedPatches) ? r.appliedPatches.length : 0;
      if (applied === 0) { process.stdout.write("false"); process.exit(0); }
      process.stdout.write("true");
    } catch {
      process.stdout.write("false");
    }
  ')"
  if [ "$is_ok" != "true" ]; then
    echo "output/facebook-result.json indicates failure or 0 applied patches."
    return 1
  fi
  local apk_found
  apk_found="$(find output -maxdepth 1 -type f \( -name "facebook-patched.apk" -o -name "facebook-*-patched.apk" \) -size +1M -print -quit 2>/dev/null)"
  if [ -z "$apk_found" ]; then
    echo "No patched Facebook APK found in output directory."
    return 1
  fi
  return 0
}

# If FACEBOOK_APK_URL is provided, download it directly first
if [ -n "${FACEBOOK_APK_URL:-}" ]; then
  echo "Downloading Facebook APK from direct URL: $FACEBOOK_APK_URL"
  mkdir -p input
  dest_file="input/facebook.apk"
  if [[ "$FACEBOOK_APK_URL" =~ \.xapk(\?.*)?$ ]]; then
    dest_file="input/facebook.xapk"
  elif [[ "$FACEBOOK_APK_URL" =~ \.apkm(\?.*)?$ ]]; then
    dest_file="input/facebook.apkm"
  fi
  if curl -sSL -f -o "$dest_file" "$FACEBOOK_APK_URL"; then
    echo "Downloaded Facebook APK from direct URL: $dest_file"
    rm -f input/facebook.apk.meta.json input/facebook.xapk.meta.json input/facebook.apkm.meta.json
  else
    echo "Warning: failed to download from FACEBOOK_APK_URL, falling back to mirror resolution."
    rm -f "$dest_file"
  fi
fi

set +e
node scripts/hushfacebook-builder.mjs build 2>&1 | tee "$build_log"
build_status=${PIPESTATUS[0]}
set -e

if [ "$build_status" -eq 0 ] && is_facebook_patch_successful "$build_log"; then
  echo "Initial Facebook build succeeded with patches applied."
  exit 0
fi

echo "Initial Facebook build failed or applied 0 patches. Clearing initial outputs and resolving supported version codes..."
clear_facebook_outputs

# Resolve expected version codes from HushFacebook patch catalog
supported_version_codes="$(node -e '
  const fs = require("node:fs");
  let patchesTag = process.env.HUSHFACEBOOK_PATCHES_VERSION || "v0.21.0";
  try {
    const meta = JSON.parse(fs.readFileSync(".cache/tools/patches-facebook.json", "utf8"));
    patchesTag = meta.tag || patchesTag;
  } catch {}

  (async () => {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/SysAdminDoc/HushFacebook/${patchesTag}/patches-list.json`);
      if (res.ok) {
        const data = await res.json();
        const patches = data.patches || (Array.isArray(data) ? data : []);
        for (const p of patches) {
          const compatibility = p.compatibility || [];
          for (const c of compatibility) {
            if (c.packageName === "com.facebook.katana") {
              for (const t of (c.targets || [])) {
                const code = t.versionCodes?.ARM64_V8A;
                if (code && t.version) {
                  process.stdout.write(JSON.stringify({ codes: [String(code)], version: t.version }));
                  return;
                }
              }
            }
          }
        }
      }
    } catch {}

    process.stdout.write(JSON.stringify({ codes: ["476015655"], version: "585.0.0.47.54" }));
  })();
')"

compatible_version="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).version)' "$supported_version_codes")"
version_codes="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).codes.join(" "))' "$supported_version_codes")"

try_patch_downloaded_apk() {
  local apk_path="$1" log_name="$2"
  clear_facebook_outputs
  local retry_log=".cache/hushfacebook-build-$log_name.log"
  local retry_status
  mkdir -p input
  local ext="${apk_path##*.}"
  local target_input="input/facebook.${ext}"
  cp "$apk_path" "$target_input"
  rm -f input/facebook.apk.meta.json input/facebook.xapk.meta.json input/facebook.apkm.meta.json
  set +e
  node scripts/hushfacebook-builder.mjs build 2>&1 | tee "$retry_log"
  retry_status=${PIPESTATUS[0]}
  set -e
  if [ "$retry_status" -eq 0 ] && is_facebook_patch_successful "$retry_log"; then
    echo "Facebook successfully patched with variant $log_name!"
    return 0
  fi
  echo "Patching Facebook with variant $log_name failed or applied 0 patches."
  clear_facebook_outputs
  return 1
}

for version_code in $version_codes; do
  echo "Trying APKPure catalog API for Facebook $compatible_version (code $version_code)..."
  download_result=""
  api_dir=".cache/hushfacebook-apkpure-api-$version_code"
  rm -rf "$api_dir"
  mkdir -p "$api_dir"
  if download_result="$(python scripts/apkpure_api_download.py \
    --app-name Facebook \
    --package-name com.facebook.katana \
    --out-dir "$api_dir" \
    --version "$compatible_version" \
    --version-code "$version_code" \
    --expect-arch arm64-v8a 2>/dev/null)"; then
    :
  else
    echo "APKPure catalog API could not provide version code $version_code; trying APKMirror..."
    download_result=""
    for org in meta-platforms-inc facebook-2; do
      if download_result="$(python scripts/apkmirror_download.py \
        --app-name Facebook \
        --package-name com.facebook.katana \
        --org "$org" \
        --repo facebook \
        --slug facebook \
        --out-dir ".cache/hushfacebook-apkmirror-$version_code" \
        --version "$compatible_version" \
        --version-code "$version_code" \
        --arch arm64-v8a \
        --dpi any \
        --type bundle 2>/dev/null)"; then
        break
      fi
    done
  fi

  if [ -n "$download_result" ]; then
    apk_path="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).path)' "$download_result" 2>/dev/null || true)"
    if [ -f "$apk_path" ]; then
      if try_patch_downloaded_apk "$apk_path" "$version_code"; then
        exit 0
      fi
    fi
  fi
done

echo ""
echo "=========================================================================================="
echo "Facebook build failed: No public mirror delivered the required arm64 variant ($version_codes)."
echo "HushFacebook patches strictly require an unmodified arm64 APK/bundle with versionCode: $version_codes."
echo "Root Cause: APKPure does not host this exact variant code, and APKMirror is Cloudflare-protected"
echo "against automated downloads from GitHub Actions runner datacenter IPs."
echo ""
echo "Workaround:"
echo "1. Download Facebook $compatible_version (arm64-v8a, versionCode $version_codes) from APKMirror:"
echo "   https://www.apkmirror.com/apk/meta-platforms-inc/facebook/facebook-${compatible_version//./-}-release/"
echo "2. Host the downloaded stock APK / bundle on a direct URL (or private GitHub release / bucket)."
echo "3. Run the workflow with the input 'facebook_apk_url' set to that direct download URL."
echo "=========================================================================================="
exit 1
