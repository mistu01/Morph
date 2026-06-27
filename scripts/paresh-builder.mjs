#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "build";
const args = process.argv.slice(3);

const isMain = process.argv[1] && (
  resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
);

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

import { externalPatchAppConfigs } from "./morphe.mjs";

export const appConfigs = externalPatchAppConfigs([
  ["alarmo", "Alarmo", "com.bytesong.missionalarm"],
  ["crex", "CREX - Just Cricket", "in.cricketexchange.app.cricketexchange"],
  ["cricbuzz", "Cricbuzz", "com.cricbuzz.android"],
  ["document-scanner", "Document Scanner", "com.cv.docscanner"],
  ["eyecon", "Eyecon Caller ID & Spam Block", "com.eyecon.global"],
  ["fing", "Fing", "com.overlook.android.fing"],
  ["jiohotstar", "JioHotstar", "in.startv.hotstar"],
  ["lumina-walls", "Lumina Walls", "com.lumina.wallpapers"],
  ["macrodroid", "MacroDroid", "com.arlosoft.macrodroid"],
  ["mark", "Mark", "com.markOne.ss_app"],
  ["plus-messenger", "Plus Messenger", "org.telegram.plus"],
  ["prompter-pal", "Prompter Pal", "com.solid.teleprompter"],
  ["proton-vpn", "Proton VPN", "ch.protonvpn.android", {
    apkmirrorOrg: "proton-technologies-ag",
    apkmirrorRepo: "protonvpn-secure-and-free-vpn",
    apkmirrorSlug: "proton-vpn-fast-secure-vpn",
    apkmirrorType: "bundle",
    apkmirrorFallbackArch: "universal",
    apkmirrorDpi: "120-640dpi",
  }],
  ["sd-maid-se", "SD Maid SE", "eu.darken.sdmse"],
  ["starsense-explorer", "StarSense Explorer", "com.celestron.skybox"],
  ["telegram", "Telegram", "org.telegram.messenger.web"],
  ["ticktick", "TickTick", "com.ticktick.task"],
  ["trackit", "TrackIt", "app.vinztech.trackit"],
  ["truecaller", "Truecaller", "com.truecaller"],
  ["vn", "VN", "com.frontrow.vlog"],
]);

if (isMain) {
  const buildTargets = env("BUILD_TARGETS") || "proton-vpn";

  validateTargets(buildTargets);

  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "paresh",
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
}

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
