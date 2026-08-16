#!/usr/bin/env node

import {
  applyDefaultPatchArgs,
  builderRoot,
  env,
  generateReleaseNotes,
  isMainScript,
  runMorphe,
} from "./builder-common.mjs";

const root = builderRoot(import.meta.url);
const command = process.argv[2] || "build";
const args = process.argv.slice(3);
const isMain = isMainScript(import.meta.url);

if (isMain && command === "release-notes") {
  generateReleaseNotes({ root, heading: "Anddea Patched Release", patchesRepo: "anddea/revanced-patches" });
  process.exit(0);
}

export const appConfigs = {}; // inherits youtube and youtube-music from morphe

if (isMain) {
  const childEnv = {
    MORPHE_BUILDER: "anddea",
    ...process.env,
    BUILD_TARGETS: env("BUILD_TARGETS") || "youtube,youtube-music",
    APK_SOURCE: env("APK_SOURCE") || "apkmirror,apkpure",
    APK_VERSION_SOURCE: env("APK_VERSION_SOURCE") || "recommended",
    APK_LATEST_COMPATIBLE_ONLY: env("APK_LATEST_COMPATIBLE_ONLY"),
    APK_FALLBACK_TO_LATEST: env("APK_FALLBACK_TO_LATEST") || "false",
    MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI: env("MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI") || "1",
    MORPHE_PATCHES_REPO: env("ANDDEA_PATCHES_REPO") || "anddea/revanced-patches",
    MORPHE_PATCHES_VERSION: env("ANDDEA_PATCHES_VERSION") || env("MORPHE_PATCHES_VERSION") || "stable",
    MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
    MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: env("MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS") || "1",
    YOUTUBE_OPTIONS: env("YOUTUBE_OPTIONS") || "config/anddea/youtube-options.json",
    YOUTUBE_MUSIC_OPTIONS: env("YOUTUBE_MUSIC_OPTIONS") || "config/anddea/youtube-music-options.json",
  };

  applyDefaultPatchArgs(childEnv, command);
  runMorphe({ root, command, args, childEnv, builderName: "anddea" });
}
