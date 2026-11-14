#!/usr/bin/env bash
set -euo pipefail

# Build and patch Facebook with HushFacebook.
# Meta Redex builds split Facebook into two main variants:
#   - minSdk 26 / Android 9+ (code 476015653): Secondary DEX in Superpack format
#     (assets/secondary-program-dex-jars/store-0.dex.spo). Cannot be decompressed
#     without an Android ART runtime, causing 0 class fingerprints to match.
#   - minSdk 30 / Android 11+ (code 476015655): All classes uncompressed as raw
#     classes.dex through classes29.dex. Morphe indexes all classes and applies patches.
#
# This script resolves the Android 11+ variant through a multi-tier fallback:
#   1. Direct URL (FACEBOOK_APK_URL) if provided.
#   2. GitHub Release stock bundle cache (apk-cache-facebook-<version>) for instant 2s builds.
#   3. Uptodown Playwright fetcher with Xvfb and Turnstile handling (with retry backoff).
#   4. APKPure catalog API / APKMirror mirror fallback.
# Once fetched, the stock bundle is cached to the GitHub Release for instant future runs.

build_log=".cache/hushfacebook-build.log"
mkdir -p .cache input output

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
cache_release_tag="apk-cache-facebook-$compatible_version"

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
  export FACEBOOK_APK="$target_input"
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

# Tier 1: Direct URL if provided
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
    export FACEBOOK_APK="$dest_file"
    set +e
    node scripts/hushfacebook-builder.mjs build 2>&1 | tee "$build_log"
    build_status=${PIPESTATUS[0]}
    set -e
    if [ "$build_status" -eq 0 ] && is_facebook_patch_successful "$build_log"; then
      echo "Facebook build succeeded with direct URL."
      exit 0
    fi
  else
    echo "Warning: failed to download from FACEBOOK_APK_URL, continuing to mirrors and cache."
    rm -f "$dest_file"
  fi
fi

# Tier 2: Check GitHub Release cache for stock bundle
cache_dir=".cache/facebook-release-cache"
mkdir -p "$cache_dir"
echo "Checking GitHub Release asset cache for $compatible_version..."
if gh release download "hushfacebook-release" -p "facebook-$compatible_version*.xapk" -D "$cache_dir" 2>/dev/null || \
   gh release download "$cache_release_tag" -D "$cache_dir" 2>/dev/null; then
  cached_bundle="$(find "$cache_dir" -maxdepth 1 -type f \( -name "*.xapk" -o -name "*.apk" -o -name "*.apkm" \) -size +10M -print -quit 2>/dev/null || true)"
  if [ -n "$cached_bundle" ] && [ -f "$cached_bundle" ]; then
    echo "Found cached Facebook stock bundle: $cached_bundle"
    if try_patch_downloaded_apk "$cached_bundle" "cache-$compatible_version"; then
      exit 0
    fi
  fi
fi

# Tier 3: Uptodown Playwright fetcher (fetches exact Android 11+ variant with backoff retries)
echo "Resolving Android 11+ variant for Facebook $compatible_version via Uptodown Playwright fetcher..."
uptodown_dir=".cache/facebook-uptodown-$compatible_version"
mkdir -p "$uptodown_dir"
xvfb_prefix=""
if command -v xvfb-run >/dev/null 2>&1; then
  xvfb_prefix="xvfb-run -a"
fi

downloaded_bundle=""
expected_bundle="$uptodown_dir/facebook-$compatible_version-arm64-v8a.xapk"
for attempt in 1 2 3 4; do
  if [ -f "$expected_bundle" ] && [ "$(wc -c < "$expected_bundle")" -gt 10000000 ]; then
    downloaded_bundle="$expected_bundle"
    echo "Found existing valid Uptodown bundle: $downloaded_bundle"
    break
  fi

  echo "== Uptodown fetch attempt $attempt for Facebook $compatible_version"
  set +e
  $xvfb_prefix python scripts/fetch_uptodown.py "$compatible_version" "$uptodown_dir" > ".cache/uptodown_stdout.json" 2> ".cache/uptodown_stderr.log"
  fetch_code=$?
  set -e
  cat ".cache/uptodown_stderr.log" 2>/dev/null || true

  candidate="$(node -e '
    const fs = require("node:fs");
    try {
      const r = JSON.parse(fs.readFileSync(".cache/uptodown_stdout.json", "utf8").trim());
      process.stdout.write(r.path || "");
    } catch {
      try {
        const text = fs.readFileSync(".cache/uptodown_stdout.json", "utf8");
        const match = text.match(/\{[^{}]*"path"\s*:\s*"([^"]+)"[^{}]*\}/);
        if (match) process.stdout.write(match[1]);
      } catch {}
    }
  ')"
  if [ -n "$candidate" ] && [ -f "$candidate" ] && [ "$(wc -c < "$candidate")" -gt 10000000 ]; then
    downloaded_bundle="$candidate"
    echo "Successfully downloaded Facebook from Uptodown: $downloaded_bundle"
    break
  fi

  if [ -f "$expected_bundle" ] && [ "$(wc -c < "$expected_bundle")" -gt 10000000 ]; then
    downloaded_bundle="$expected_bundle"
    echo "Successfully downloaded Facebook from Uptodown: $downloaded_bundle"
    break
  fi

  any_saved="$(find "$uptodown_dir" -maxdepth 1 -type f \( -name "*.xapk" -o -name "*.apk" -o -name "*.apkm" \) -size +10M -print -quit 2>/dev/null || true)"
  if [ -n "$any_saved" ] && [ -f "$any_saved" ]; then
    downloaded_bundle="$any_saved"
    echo "Found downloaded bundle in directory: $downloaded_bundle"
    break
  fi

  echo "Attempt $attempt failed; sleeping $((attempt * 15))s..."
  sleep $((attempt * 15))
done

if [ -n "$downloaded_bundle" ] && [ -f "$downloaded_bundle" ]; then
  if try_patch_downloaded_apk "$downloaded_bundle" "uptodown-$compatible_version"; then
    if [ -n "${GITHUB_TOKEN:-}" ]; then
      echo "Caching stock split bundle to hushfacebook-release for instant future builds..."
      gh release upload "hushfacebook-release" "$downloaded_bundle" --clobber >/dev/null 2>&1 || true
    fi
    exit 0
  fi
fi

# Tier 4: Fallback mirror lookups (APKPure catalog API & APKMirror)
echo "Uptodown fetcher did not complete; checking APKPure catalog API & APKMirror..."
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
        if [ -n "${GITHUB_TOKEN:-}" ]; then
          echo "Caching stock split bundle to hushfacebook-release for instant future builds..."
          stock_cache_name="facebook-$compatible_version-arm64-v8a.${apk_path##*.}"
          cp "$apk_path" "$stock_cache_name"
          gh release upload "hushfacebook-release" "$stock_cache_name" --clobber >/dev/null 2>&1 || true
          rm -f "$stock_cache_name"
        fi
        exit 0
      fi
    fi
  fi
done

echo ""
echo "=========================================================================================="
echo "Facebook build failed: No public mirror delivered the required arm64 variant ($version_codes)."
echo "HushFacebook patches strictly require an unmodified arm64 APK/bundle with versionCode: $version_codes."
echo "=========================================================================================="
exit 1
