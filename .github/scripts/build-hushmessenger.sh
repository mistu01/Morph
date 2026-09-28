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
  const match = output.match(/Use an unmodified arm64 Messenger\b[\s\S]{0,180}?version code\s+([\d\sor]+)/i);
  if (match) {
    const codes = [...match[1].matchAll(/\d{7,}/g)].map(([code]) => code);
    process.stdout.write([...new Set(codes)].join(","));
  }
' "$build_log")"

if [ -z "$supported_version_codes" ]; then
  echo "Messenger build failed and HushMessenger did not report alternate supported APK version codes."
  exit "$build_status"
fi

echo "Retrying Messenger with HushMessenger-supported APK version code(s): $supported_version_codes"
MESSENGER_APKMIRROR_VERSION_CODES="$supported_version_codes" \
  node scripts/hushfacebook-builder.mjs download --force-download

rm -f output/messenger-patched.apk output/messenger-result.json
MESSENGER_APKMIRROR_VERSION_CODES="$supported_version_codes" \
  node scripts/hushfacebook-builder.mjs build
