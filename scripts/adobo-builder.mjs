#!/usr/bin/env node
// Adobo builder — wraps morphe.mjs for the jkennethcarino/adobo patch repo.
// Patches: https://github.com/jkennethcarino/adobo

import {
  applyDefaultPatchArgs,
  builderRoot,
  env,
  generateReleaseNotes,
  isMainScript,
  parseTargets,
  runMorphe,
  validateTargets,
} from "./builder-common.mjs";
import { externalPatchAppConfigs, morpheAppConfigs } from "./morphe.mjs";

const root = builderRoot(import.meta.url);
const command = process.argv[2] || "build";
const args = process.argv.slice(3);
const isMain = isMainScript(import.meta.url);

if (isMain && command === "release-notes") {
  generateReleaseNotes({ root, heading: "Adobo Patched Release", patchesRepo: "jkennethcarino/adobo" });
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Adobo targets — every app supported by jkennethcarino/adobo
// Map from short target id → { packageName, label }
// Used for validation / documentation only; morphe.mjs drives the actual build.
// ---------------------------------------------------------------------------
export const ADOBO_APPS = {
  "9gag":             { packageName: "com.ninegag.android.app",              label: "9GAG" },
  "gboard":           { packageName: "com.google.android.inputmethod.latin", label: "Gboard" },
  "imdb":             { packageName: "com.imdb.mobile",                      label: "IMDb" },
  "reddit":           { packageName: "com.reddit.frontpage",                  label: "Reddit" },
};

export const appConfigs = {
  ...externalPatchAppConfigs([
    ["9gag", "9GAG", "com.ninegag.android.app", { apkmirrorOrg: "9gag", apkmirrorRepo: "9gag-funny-gif-meme-video-pics-cosplay-social" }],
    ["gboard", "Gboard", "com.google.android.inputmethod.latin", { apkmirrorOrg: "google-inc", apkmirrorRepo: "gboard-the-google-keyboard", apkmirrorType: "bundle", apkmirrorFallbackArch: "universal", apkmirrorDpi: "120-640dpi" }],
    ["imdb", "IMDb", "com.imdb.mobile", { apkmirrorOrg: "imdb", apkmirrorRepo: "imdb-movies-tv-shows" }],
  ]),
  reddit: morpheAppConfigs.reddit
};

if (isMain) {
  const parsedTargets = parseTargets(env("BUILD_TARGETS") || "reddit,gboard");

  validateTargets(command, parsedTargets, { supported: ADOBO_APPS, family: "Adobo" });

  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "adobo",
    BUILD_TARGETS: parsedTargets.join(","),
    APK_SOURCE: env("APK_SOURCE") || "apkmirror,apkpure",
    APK_VERSION_SOURCE: env("APK_VERSION_SOURCE") || "recommended",
    APK_LATEST_COMPATIBLE_ONLY: env("APK_LATEST_COMPATIBLE_ONLY"),
    APK_FALLBACK_TO_LATEST: env("APK_FALLBACK_TO_LATEST") || "false",
    MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI: env("MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI") || "1",
    // Adobo patch source
    MORPHE_PATCHES_REPO: env("ADOBO_PATCHES_REPO") || "jkennethcarino/adobo",
    MORPHE_PATCHES_VERSION: env("ADOBO_PATCHES_VERSION") || env("MORPHE_PATCHES_VERSION") || "stable",
    MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
    MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: env("MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS") || "1",
    ROOT_ALLOW_OPTIONS_FILE: "1",
  };

  applyDefaultPatchArgs(childEnv, command);
  runMorphe({ root, command, args, childEnv, builderName: "adobo" });
}
