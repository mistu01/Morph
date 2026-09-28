#!/usr/bin/env bash
set -euo pipefail

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
  const output = fs.readFileSync(process.argv[1], "utf8");
  const guidance = output.match(/Use an unmodified arm64 Messenger\b([^\r\n]*)/i)?.[1] || "";
  const codeClause = guidance.match(/version codes?\s+([^)]*)/i)?.[1] || "";
  if (guidance && codeClause) {
    const codes = [...codeClause.matchAll(/\d{7,}/g)].map(([code]) => code);
    const version = guidance.match(/^\s*([\d]+(?:\.[\d]+)+)\s+APK/i)?.[1] || "";
    process.stdout.write(JSON.stringify({ codes: [...new Set(codes)], version }));
  }
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

for version_code in $version_codes; do
  echo "Downloading Messenger $compatible_version from APKPure with supported version code $version_code"
  if ! download_result="$(python scripts/apkpure_download.py \
    --app-name Messenger \
    --package-name com.facebook.orca \
    --source-page https://apkpure.com/messenger/com.facebook.orca \
    --out-dir ".cache/hushmessenger-apkpure-$version_code" \
    --version "$compatible_version" \
    --version-code "$version_code")"; then
    echo "APKPure could not download Messenger version code $version_code; trying the next supported variant."
    continue
  fi
  apk_path="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).path)' "$download_result")"

  rm -f output/messenger-patched.apk output/messenger-*-patched.apk output/messenger-result.json
  retry_log=".cache/hushmessenger-build-$version_code.log"
  set +e
  MESSENGER_APK="$apk_path" node scripts/hushfacebook-builder.mjs build 2>&1 | tee "$retry_log"
  retry_status=${PIPESTATUS[0]}
  set -e

  if [ "$retry_status" -eq 0 ]; then
    exit 0
  fi
done

echo "Direct APKPure downloads failed; retrying the exact compatible version through Morphe's APKPure/apkeep fallback."
rm -f input/messenger.apk input/messenger.apkm input/messenger.xapk input/messenger.apks
rm -f output/messenger-patched.apk output/messenger-*-patched.apk output/messenger-result.json
set +e
MESSENGER_APK_VERSION="$compatible_version" APK_SOURCE=apkpure node scripts/hushfacebook-builder.mjs build 2>&1 | tee ".cache/hushmessenger-apkeep-$compatible_version.log"
apkeep_status=${PIPESTATUS[0]}
set -e

if [ "$apkeep_status" -eq 0 ]; then
  exit 0
fi

echo "Messenger build failed for every HushMessenger-compatible APK variant and the APKPure/apkeep fallback."
exit 1
