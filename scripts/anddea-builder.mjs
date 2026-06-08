#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "build";
const args = process.argv.slice(3);

const childEnv = {
  ...process.env,
  BUILD_TARGETS: env("BUILD_TARGETS") || "youtube,youtube-music,reddit",
  APK_SOURCE: env("APK_SOURCE") || "apkmirror,apkpure,uptodown,divxland",
  APK_VERSION_SOURCE: env("APK_VERSION_SOURCE") || "recommended",
  APK_FALLBACK_TO_LATEST: env("APK_FALLBACK_TO_LATEST") || "false",
  MORPHE_PATCHES_REPO: env("ANDDEA_PATCHES_REPO") || "anddea/revanced-patches",
  MORPHE_PATCHES_VERSION: env("ANDDEA_PATCHES_VERSION") || env("MORPHE_PATCHES_VERSION") || "stable",
  MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
  MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: env("MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS") || "1",
  YOUTUBE_OPTIONS: env("YOUTUBE_OPTIONS") || "config/anddea/youtube-options.json",
  YOUTUBE_MUSIC_OPTIONS: env("YOUTUBE_MUSIC_OPTIONS") || "config/anddea/youtube-music-options.json",
  REDDIT_OPTIONS: env("REDDIT_OPTIONS") || "config/anddea/reddit-options.json",
};

if (command === "build" && !env("MORPHE_EXTRA_ARGS_JSON")) {
  childEnv.MORPHE_EXTRA_ARGS_JSON = JSON.stringify(defaultPatchArgs());
}

const result = spawnSync(
  process.execPath,
  [join(root, "scripts/morphe.mjs"), command, ...args],
  {
    cwd: root,
    env: childEnv,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`anddea-builder failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

function defaultPatchArgs() {
  const args = [];
  if (truthy(env("FORCE_PATCH") || "true")) args.push("--force");
  if (truthy(env("CONTINUE_ON_ERROR") || "true")) args.push("--continue-on-error");
  return args;
}

function env(name) {
  return process.env[name] || "";
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}
