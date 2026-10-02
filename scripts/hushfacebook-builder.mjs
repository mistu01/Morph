#!/usr/bin/env node
// Hush social app builder — patches Facebook, Messenger, Threads, and Instagram (HushGram) with separate sources.

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
const patchesRepoFor = (target) => {
  if (target === "messenger") return "SysAdminDoc/HushMessenger";
  if (target === "threads") return "SysAdminDoc/HushThreads";
  if (target === "instagram" || target === "hushgram") return "SysAdminDoc/HushGram";
  return "SysAdminDoc/HushFacebook";
};

if (isMain && command === "release-notes") {
  generateReleaseNotes({
    root,
    heading: "Hush Social Patched APKs",
    patchesSources: [
      {
        appId: "facebook",
        label: "Facebook Patches",
        repo: "SysAdminDoc/HushFacebook",
        metaFile: ".cache/tools/patches-facebook.json",
        envVar: "HUSHFACEBOOK_PATCHES_VERSION",
        configKey: "hushfacebook",
      },
      {
        appId: "messenger",
        label: "Messenger Patches",
        repo: "SysAdminDoc/HushMessenger",
        metaFile: ".cache/tools/patches-messenger.json",
        envVar: "HUSHMESSENGER_PATCHES_VERSION",
        configKey: "hushmessenger",
      },
      {
        appId: "threads",
        label: "Threads Patches",
        repo: "SysAdminDoc/HushThreads",
        metaFile: ".cache/tools/patches-threads.json",
        envVar: "HUSHTHREADS_PATCHES_VERSION",
        configKey: "hushthreads",
      },
      {
        appId: "instagram",
        label: "HushGram Patches",
        repo: "SysAdminDoc/HushGram",
        metaFile: ".cache/tools/patches-hushgram.json",
        envVar: "HUSHGRAM_PATCHES_VERSION",
        configKey: "hushgram",
      },
    ],
  });
  process.exit(0);
}

const supportedTargets = {
  facebook: { packageName: "com.facebook.katana", label: "Facebook" },
  messenger: { packageName: "com.facebook.orca", label: "Messenger" },
  threads: { packageName: "com.instagram.barcelona", label: "Threads" },
  instagram: { packageName: "com.instagram.android", label: "Instagram" },
  hushgram: { packageName: "com.instagram.android", label: "Instagram" },
};

export const appConfigs = externalPatchAppConfigs([
  ["facebook", "Facebook", "com.facebook.katana", {
    apkmirrorOrg: "facebook-2",
    apkmirrorRepo: "facebook",
    apkmirrorType: "bundle",
    apkmirrorArch: "arm64-v8a",
    apkmirrorFallbackArch: "",
    apkmirrorDpi: "any",
    apkpureMinAndroidApi: env("FACEBOOK_MIN_ANDROID_API") ? Number(env("FACEBOOK_MIN_ANDROID_API")) : 26,
  }],
  ["messenger", "Messenger", "com.facebook.orca", {
    apkmirrorOrg: "facebook-2",
    apkmirrorRepo: "messenger",
    apkmirrorType: "apk",
    apkmirrorArch: "arm64-v8a",
    apkmirrorFallbackArch: "",
    apkmirrorDpi: "any",
  }],
  ["threads", "Threads", "com.instagram.barcelona", {
    apkmirrorOrg: "instagram",
    apkmirrorRepo: "threads-an-instagram-app",
    apkmirrorType: "bundle",
    apkmirrorArch: "arm64-v8a",
    apkmirrorFallbackArch: "",
    apkmirrorDpi: "nodpi",
    apkpureSlug: "threads-an-instagram-app",
  }],
  ["instagram", "Instagram", "com.instagram.android", {
    apkmirrorOrg: "instagram",
    apkmirrorRepo: "instagram-instagram",
    apkmirrorType: "bundle",
    apkmirrorArch: "arm64-v8a",
    apkmirrorFallbackArch: "",
    apkmirrorDpi: "nodpi",
    apkpureSlug: "instagram",
  }],
]);

if (isMain) {
  const parsedTargets = parseTargets(env("BUILD_TARGETS") || "facebook");
  validateTargets(command, parsedTargets, { supported: supportedTargets, family: "Hush social apps" });
  if (parsedTargets.length !== 1 && !["release-check"].includes(command)) throw new Error("Build exactly one Hush target per invocation so each target uses its own patch source.");
  const rawTarget = parsedTargets[0];
  const target = rawTarget === "hushgram" ? "instagram" : rawTarget;
  let source = "HUSHFACEBOOK";
  if (target === "messenger") source = "HUSHMESSENGER";
  else if (target === "threads") source = "HUSHTHREADS";
  else if (target === "instagram") source = "HUSHGRAM";

  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "hushfacebook",
    BUILD_TARGETS: target,
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
    MESSENGER_APKMIRROR_TYPE: env("MESSENGER_APKMIRROR_TYPE") || "apk",
    MESSENGER_APKMIRROR_ARCH: "arm64-v8a",
    MESSENGER_APKMIRROR_FALLBACK_ARCH: "",
    MESSENGER_APKMIRROR_DPI: "any",
    MESSENGER_OPTIONS: env("MESSENGER_OPTIONS") || "config/hushfacebook/messenger-options.json",
    MESSENGER_APK_VERSION: env("MESSENGER_APK_VERSION") || "",
    MESSENGER_APK_URL: env("MESSENGER_APK_URL") || "",
    THREADS_APKMIRROR_TYPE: env("THREADS_APKMIRROR_TYPE") || "bundle",
    THREADS_APKMIRROR_ARCH: "arm64-v8a",
    THREADS_APKMIRROR_FALLBACK_ARCH: "",
    THREADS_APKMIRROR_DPI: "nodpi",
    THREADS_OPTIONS: env("THREADS_OPTIONS") || "config/hushfacebook/threads-options.json",
    THREADS_APK_VERSION: env("THREADS_APK_VERSION") || "",
    THREADS_APK_URL: env("THREADS_APK_URL") || "",
    INSTAGRAM_APKMIRROR_TYPE: env("INSTAGRAM_APKMIRROR_TYPE") || "bundle",
    INSTAGRAM_APKMIRROR_ARCH: "arm64-v8a",
    INSTAGRAM_APKMIRROR_FALLBACK_ARCH: "",
    INSTAGRAM_APKMIRROR_DPI: "nodpi",
    INSTAGRAM_OPTIONS: env("INSTAGRAM_OPTIONS") || "config/hushfacebook/instagram-options.json",
    INSTAGRAM_APK_VERSION: env("INSTAGRAM_APK_VERSION") || "",
    INSTAGRAM_APK_URL: env("INSTAGRAM_APK_URL") || "",
  };

  applyDefaultPatchArgs(childEnv, command, { forcePatch: false });
  runMorphe({ root, command, args, childEnv, builderName: "hushfacebook" });
}
