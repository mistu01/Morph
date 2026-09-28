#!/usr/bin/env node
// Download a specific Facebook Messenger version from APKCombo.
// Tries both APK and XAPK (bundle) formats: Messenger is published as an
// XAPK bundle for recent builds, and the APK-only lookup crashes inside the
// downloader when no APK variant exists.

import { resolve } from "node:path";
import { APKComboDownloader } from "@nirewen/apkcombo-downloader";

const [version, outDir] = process.argv.slice(2);
if (!version || !outDir) {
  console.error("Usage: node scripts/apkcombo_download.mjs <version> <out-dir>");
  process.exit(2);
}

const writeResult = console.log.bind(console);
console.log = (...values) => console.error(...values);

let lastError = null;
for (const type of ["bundle", "apk"]) {
  try {
    console.error(`Trying APKCombo ${type} download for ${version}...`);
    const result = await APKComboDownloader.download(
      { org: "facebook-messenger", repo: "com.facebook.orca" },
      {
        version,
        arch: "arm64-v8a",
        dpi: "any",
        type,
        outDir,
        overwrite: true,
      },
    );
    writeResult(JSON.stringify({ path: resolve(result.dest), fileType: type }));
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.error(`APKCombo ${type} download failed: ${error.message}`);
  }
}

console.error(`APKCombo could not download Messenger ${version} in any supported format.`);
process.exit(1);
