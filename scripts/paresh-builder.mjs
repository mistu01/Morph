#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "build";
const args = process.argv.slice(3);
const supportedTargets = new Set([
  "alarmo",
  "crex",
  "cricbuzz",
  "document-scanner",
  "eyecon",
  "fing",
  "jiohotstar",
  "lumina-walls",
  "macrodroid",
  "mark",
  "plus-messenger",
  "prompter-pal",
  "proton-vpn",
  "sd-maid-se",
  "starsense-explorer",
  "telegram",
  "ticktick",
  "trackit",
  "truecaller",
  "vn",
]);
const buildTargets = env("BUILD_TARGETS") || "proton-vpn";

validateTargets(buildTargets);

const childEnv = {
  ...process.env,
  BUILD_TARGETS: buildTargets,
  APK_SOURCE: env("APK_SOURCE") || "apkmirror,apkpure",
  APK_VERSION_SOURCE: "recommended",
  APK_LATEST_COMPATIBLE_ONLY: "",
  APK_FALLBACK_TO_LATEST: "false",
  APKMIRROR_ARCH: env("APKMIRROR_ARCH") || "arm64-v8a",
  MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI: env("MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI") || "0",
  MORPHE_PATCHES_PROVIDER: "gitlab",
  MORPHE_PATCHES_REPO: env("PARESH_PATCHES_REPO") || "Paresh-Maheshwari/paresh-patches",
  MORPHE_PATCHES_VERSION: env("PARESH_PATCHES_VERSION") || env("MORPHE_PATCHES_VERSION") || "stable",
  MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
  MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: env("MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS") || "1",
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
  console.error(`paresh-builder failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

function defaultPatchArgs() {
  const args = [];
  if (truthy(env("CONTINUE_ON_ERROR") || "true")) args.push("--continue-on-error");
  return args;
}

function validateTargets(value) {
  if (!["build", "download", "options", "release-check", "release-notes"].includes(command)) return;

  const requested = value.split(",").map((target) => target.trim().toLowerCase()).filter(Boolean);
  const unknown = requested.filter((target) => !supportedTargets.has(target));
  if (unknown.length) {
    console.error(`Unsupported Paresh target(s): ${unknown.join(", ")}`);
    console.error(`Supported Paresh targets: ${[...supportedTargets].join(", ")}`);
    process.exit(1);
  }
}

function env(name) {
  return process.env[name] || "";
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}
