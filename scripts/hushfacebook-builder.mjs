#!/usr/bin/env node
// Hush social app builder — patches Facebook and Messenger with separate sources.

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
const patchesRepoFor = (target) => target === "messenger" ? "SysAdminDoc/HushMessenger" : "SysAdminDoc/HushFacebook";

if (isMain && command === "release-notes") {
  generateReleaseNotes({ root, heading: "HushFacebook & HushMessenger Patched APKs", patchesRepo: "SysAdminDoc/HushMessenger" });
  process.exit(0);
}

const supportedTargets = {
  facebook: { packageName: "com.facebook.katana", label: "Facebook" },
  messenger: { packageName: "com.facebook.orca", label: "Messenger" },
};

export const appConfigs = externalPatchAppConfigs([
  ["facebook", "Facebook", "com.facebook.katana", {
    apkmirrorOrg: "facebook-2",
    apkmirrorRepo: "facebook",
    apkmirrorType: "bundle",
    apkmirrorArch: "arm64-v8a",
    apkmirrorFallbackArch: "",
    apkmirrorDpi: "any",
    apkpureMinAndroidApi: 30,
  }],
  ["messenger", "Messenger", "com.facebook.orca", {
    apkmirrorOrg: "facebook-2",
    apkmirrorRepo: "messenger",
    apkmirrorType: "bundle",
    apkmirrorArch: "arm64-v8a",
    apkmirrorFallbackArch: "",
    apkmirrorDpi: "any",
  }],
]);

if (isMain) {
  const parsedTargets = parseTargets(env("BUILD_TARGETS") || "facebook");
  validateTargets(command, parsedTargets, { supported: supportedTargets, family: "Hush social apps" });
  if (parsedTargets.length !== 1 && !["release-check"].includes(command)) throw new Error("Build exactly one Hush target per invocation so each target uses its own patch source.");
  const target = parsedTargets[0];
  const source = target === "messenger" ? "HUSHMESSENGER" : "HUSHFACEBOOK";

  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "hushfacebook",
    BUILD_TARGETS: parsedTargets.join(","),
    APK_SOURCE: env("APK_SOURCE") || "apkmirror,apkpure",
    APK_VERSION_SOURCE: env("APK_VERSION_SOURCE") || "recommended",
    APK_FALLBACK_TO_LATEST: env("APK_FALLBACK_TO_LATEST") || "false",
    APKMIRROR_ARCH: "arm64-v8a",
    FACEBOOK_APKMIRROR_TYPE: "bundle",
    FACEBOOK_APKMIRROR_FALLBACK_ARCH: "",
    FACEBOOK_APKMIRROR_DPI: "any",
    MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI: "0",
    MORPHE_PATCHES_REPO: env(`${source}_PATCHES_REPO`) || patchesRepoFor(target),
    MORPHE_PATCHES_VERSION: env(`${source}_PATCHES_VERSION`) || env("MORPHE_PATCHES_VERSION") || "stable",
    MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
    MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: "1",
    FACEBOOK_OPTIONS: env("FACEBOOK_OPTIONS") || "config/hushfacebook/facebook-options.json",
    FACEBOOK_APK_VERSION: env("FACEBOOK_APK_VERSION") || "",
    FACEBOOK_APK_URL: env("FACEBOOK_APK_URL") || "",
    MESSENGER_APKMIRROR_TYPE: "bundle",
    MESSENGER_APKMIRROR_ARCH: "arm64-v8a",
    MESSENGER_APKMIRROR_FALLBACK_ARCH: "",
    MESSENGER_APKMIRROR_DPI: "any",
    MESSENGER_OPTIONS: env("MESSENGER_OPTIONS") || "config/hushfacebook/messenger-options.json",
    MESSENGER_APK_VERSION: env("MESSENGER_APK_VERSION") || "",
    MESSENGER_APK_URL: env("MESSENGER_APK_URL") || "",
  };

  applyDefaultPatchArgs(childEnv, command, { forcePatch: false });
  runMorphe({ root, command, args, childEnv, builderName: "hushfacebook" });
}
