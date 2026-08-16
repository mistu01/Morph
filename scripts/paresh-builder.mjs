#!/usr/bin/env node

import {
  applyDefaultPatchArgs,
  builderRoot,
  env,
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
  const parsedTargets = parseTargets(env("BUILD_TARGETS") || "proton-vpn");

  validateTargets(command, parsedTargets, { supported: supportedTargets, family: "Paresh" });

  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "paresh",
    BUILD_TARGETS: parsedTargets.join(","),
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

  applyDefaultPatchArgs(childEnv, command, { forcePatch: false });
  runMorphe({ root, command, args, childEnv, builderName: "paresh" });
}
