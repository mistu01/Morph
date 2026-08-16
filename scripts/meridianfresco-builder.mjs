#!/usr/bin/env node
// MeridianFresco Meta Patches builder — wraps morphe.mjs for the meridianfresco/morphe-meta-patches repo.
// Patches: https://github.com/meridianfresco/morphe-meta-patches

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
  generateReleaseNotes({ root, heading: "MeridianFresco Meta Patches Release", patchesRepo: "meridianfresco/morphe-meta-patches" });
  process.exit(0);
}

// ---------------------------------------------------------------------------
// MeridianFresco target map
// ---------------------------------------------------------------------------
export const MERIDIANFRESCO_APPS = {
  facebook: { packageName: "com.facebook.katana", label: "Facebook" },
};

export const appConfigs = externalPatchAppConfigs([
  ["facebook", "Facebook", "com.facebook.katana", { apkmirrorOrg: "facebook-2", apkmirrorRepo: "facebook", apkmirrorType: "bundle", apkmirrorFallbackArch: "universal", apkmirrorDpi: "nodpi" }],
]);

if (isMain) {
  const parsedTargets = parseTargets(env("BUILD_TARGETS") || "facebook");

  validateTargets(command, parsedTargets, { supported: MERIDIANFRESCO_APPS, family: "MeridianFresco" });

  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "meridianfresco",
    BUILD_TARGETS: parsedTargets.join(","),
    APK_SOURCE: env("APK_SOURCE") || "apkmirror,apkpure",
    APK_VERSION_SOURCE: env("APK_VERSION_SOURCE") || "latest",
    APK_LATEST_COMPATIBLE_ONLY: env("APK_LATEST_COMPATIBLE_ONLY"),
    APK_FALLBACK_TO_LATEST: env("APK_FALLBACK_TO_LATEST") || "true",
    MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI: env("MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI") || "1",
    // MeridianFresco patch source
    MORPHE_PATCHES_REPO: env("MERIDIANFRESCO_PATCHES_REPO") || "meridianfresco/morphe-meta-patches",
    MORPHE_PATCHES_VERSION: env("MERIDIANFRESCO_PATCHES_VERSION") || env("MORPHE_PATCHES_VERSION") || "stable",
    MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
    MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: env("MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS") || "1",
    ROOT_ALLOW_OPTIONS_FILE: "1",
    FACEBOOK_OPTIONS: env("FACEBOOK_OPTIONS") || "config/meridianfresco/facebook-options.json",
    FACEBOOK_APK_VERSION: env("FACEBOOK_APK_VERSION") || env("APK_VERSION") || "498.0.0.54.74",
  };

  applyDefaultPatchArgs(childEnv, command);
  runMorphe({ root, command, args, childEnv, builderName: "meridianfresco" });
}
