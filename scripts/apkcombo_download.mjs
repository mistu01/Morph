#!/usr/bin/env node

import { resolve } from "node:path";
import { APKComboDownloader } from "@nirewen/apkcombo-downloader";

const [version, outDir] = process.argv.slice(2);
if (!version || !outDir) {
  console.error("Usage: node scripts/apkcombo_download.mjs <version> <out-dir>");
  process.exit(2);
}

const writeResult = console.log.bind(console);
console.log = (...values) => console.error(...values);

const result = await APKComboDownloader.download(
  { org: "facebook-messenger", repo: "com.facebook.orca" },
  {
    version,
    arch: "arm64-v8a",
    dpi: "any",
    type: "apk",
    outDir,
    overwrite: true,
  },
);

writeResult(JSON.stringify({ path: resolve(result.dest) }));
