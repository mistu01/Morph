#!/usr/bin/env node
// Gboard-patches builder — wraps morphe.mjs for the jasonwu1994/Gboard-patches repo.
// Patches: https://github.com/jasonwu1994/Gboard-patches

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
import { externalPatchAppConfigs } from "./morphe.mjs";

const root = builderRoot(import.meta.url);
const command = process.argv[2] || "build";
const args = process.argv.slice(3);
const isMain = isMainScript(import.meta.url);

if (isMain && command === "release-notes") {
  generateReleaseNotes({ root, heading: "Gboard Patches Patched Release", patchesRepo: "jasonwu1994/Gboard-patches" });
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Gboard-patches targets
// Map from short target id → { packageName, label }
// ---------------------------------------------------------------------------
export const GBOARD_PATCHES_APPS = {
  "gboard": { packageName: "com.google.android.inputmethod.latin", label: "Gboard" },
};

export const appConfigs = externalPatchAppConfigs([
  ["gboard", "Gboard", "com.google.android.inputmethod.latin", { apkmirrorOrg: "google-inc", apkmirrorRepo: "gboard-the-google-keyboard", apkmirrorType: "bundle", apkmirrorFallbackArch: "universal", apkmirrorDpi: "120-640dpi" }],
]);

if (isMain) {
  const parsedTargets = parseTargets(env("BUILD_TARGETS") || "gboard");

  validateTargets(command, parsedTargets, { supported: GBOARD_PATCHES_APPS, family: "Gboard" });

  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "gboard-patches",
    BUILD_TARGETS: parsedTargets.join(","),
    APK_SOURCE: env("APK_SOURCE") || "apkmirror,apkpure",
    APK_VERSION_SOURCE: env("APK_VERSION_SOURCE") || "recommended",
    APK_LATEST_COMPATIBLE_ONLY: env("APK_LATEST_COMPATIBLE_ONLY"),
    APK_FALLBACK_TO_LATEST: env("APK_FALLBACK_TO_LATEST") || "false",
    MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI: env("MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI") || "1",
    // Gboard patches source
    MORPHE_PATCHES_REPO: env("GBOARD_PATCHES_REPO") || "jasonwu1994/Gboard-patches",
    MORPHE_PATCHES_VERSION: env("GBOARD_PATCHES_VERSION") || env("MORPHE_PATCHES_VERSION") || "stable",
    MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
    MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: env("MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS") || "1",
    ROOT_ALLOW_OPTIONS_FILE: "1",
    GBOARD_OPTIONS: env("GBOARD_OPTIONS") || "config/gboard-patches/gboard-options.json",
  };

  applyDefaultPatchArgs(childEnv, command);
  runMorphe({ root, command, args, childEnv, builderName: "gboard-patches" });
}
