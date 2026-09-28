#!/usr/bin/env node
// HushFacebook builder — patches Facebook with SysAdminDoc/HushFacebook.

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
const patchesRepo = "SysAdminDoc/HushFacebook";

if (isMain && command === "release-notes") {
  generateReleaseNotes({ root, heading: "HushFacebook Patched APKs", patchesRepo });
  process.exit(0);
}

const supportedTargets = { facebook: { packageName: "com.facebook.katana", label: "Facebook" } };

export const appConfigs = externalPatchAppConfigs([
  ["facebook", "Facebook", "com.facebook.katana", {
    apkmirrorOrg: "facebook-2",
    apkmirrorRepo: "facebook",
    apkmirrorType: "bundle",
    apkmirrorArch: "arm64-v8a",
    apkmirrorFallbackArch: "",
    apkmirrorDpi: "any",
  }],
]);

if (isMain) {
  const parsedTargets = parseTargets(env("BUILD_TARGETS") || "facebook");
  validateTargets(command, parsedTargets, { supported: supportedTargets, family: "HushFacebook" });

  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "hushfacebook",
    BUILD_TARGETS: parsedTargets.join(","),
    APK_SOURCE: env("APK_SOURCE") || "apkmirror",
    APK_VERSION_SOURCE: env("APK_VERSION_SOURCE") || "recommended",
    APK_FALLBACK_TO_LATEST: env("APK_FALLBACK_TO_LATEST") || "false",
    APKMIRROR_ARCH: "arm64-v8a",
    FACEBOOK_APKMIRROR_TYPE: "bundle",
    FACEBOOK_APKMIRROR_FALLBACK_ARCH: "",
    FACEBOOK_APKMIRROR_DPI: "any",
    MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI: "0",
    MORPHE_PATCHES_REPO: env("HUSHFACEBOOK_PATCHES_REPO") || patchesRepo,
    MORPHE_PATCHES_VERSION: env("HUSHFACEBOOK_PATCHES_VERSION") || env("MORPHE_PATCHES_VERSION") || "stable",
    MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
    MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: "1",
    FACEBOOK_OPTIONS: env("FACEBOOK_OPTIONS") || "config/hushfacebook/facebook-options.json",
    FACEBOOK_APK_VERSION: env("FACEBOOK_APK_VERSION") || "",
    FACEBOOK_APK_URL: env("FACEBOOK_APK_URL") || "",
  };

  applyDefaultPatchArgs(childEnv, command, { forcePatch: false });
  runMorphe({ root, command, args, childEnv, builderName: "hushfacebook" });
}
