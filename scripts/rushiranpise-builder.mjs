#!/usr/bin/env node
// Rushiranpise builder — wraps morphe.mjs for the rushiranpise/morphe-patches repo.
// Patches: https://github.com/rushiranpise/morphe-patches

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
  generateReleaseNotes({ root, heading: "Rushiranpise Patched Release", patchesRepo: "rushiranpise/morphe-patches" });
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Rushiranpise targets — every app supported by rushiranpise/morphe-patches
// Map from short target id → { packageName, label }
// Used for validation / documentation only; morphe.mjs drives the actual build.
// ---------------------------------------------------------------------------
export const RUSHIRANPISE_APPS = {
  "1111-warp":            { packageName: "com.cloudflare.onedotonedotonedotone",   label: "1.1.1.1 + WARP" },
  "adguard-nightly":      { packageName: "com.adguard.android", label: "AdGuard Nightly" },
  "aida64":               { packageName: "com.finalwire.aida64",                  label: "AIDA64" },
  "blocker-hero":         { packageName: "com.nicholasregan.blockerhero",          label: "Blocker Hero" },
  "call-recorder":        { packageName: "com.appstar.callrecorder",              label: "Call Recorder" },
  "canva":                { packageName: "com.canva.editor",                      label: "Canva" },
  "case-tracker":         { packageName: "com.saldous.casetracker",               label: "Case Tracker" },
  "citizen":              { packageName: "com.sp0n.citizen",                      label: "Citizen" },
  "cpu-z":                { packageName: "com.cpuid.cpu_z",                       label: "CPU-Z" },
  "crime-radar":          { packageName: "com.newsbreak.crimeradar",              label: "Crime Radar" },
  "flightradar24":        { packageName: "com.flightradar24free",                 label: "Flightradar24" },
  "greenify":             { packageName: "com.oasisfeng.greenify",                label: "Greenify" },
  "hibernator":           { packageName: "com.tafayor.hibernator",                label: "Hibernator" },
  "hola-vpn":             { packageName: "org.hola.play",                         label: "Hola VPN Proxy Plus" },
  "http-mock":            { packageName: "com.shexa.httpmock",                    label: "HTTP Mock" },
  "inscode-autoclicker":  { packageName: "com.inscode.autoclicker",              label: "Inscode Auto Clicker" },
  "kill-apps":            { packageName: "com.zenzen.killapps",                   label: "Kill Apps" },
  "m-indicator":          { packageName: "com.mobond.mindicator",                 label: "m-Indicator" },
  "mirko":                { packageName: "it.mirko.bus",                          label: "Mirko" },
  "ml-manager":           { packageName: "com.javiersantos.mlmanager.pro",        label: "ML Manager" },
  "myperm":               { packageName: "app.myperm",                            label: "MyPerm" },
  "netguard":             { packageName: "eu.faircode.netguard",                  label: "NetGuard" },
  "netmonster":           { packageName: "cz.mroczis.netmonster",                 label: "NetMonster" },
  "netshare":             { packageName: "kha.prog.mikrotik",                     label: "NetShare" },
  "nzb360":               { packageName: "com.kevinforeman.nzb360",               label: "nzb360" },
  "photo-editor":         { packageName: "com.iudesk.android.photo.editor",       label: "Photo Editor" },
  "pialytic":             { packageName: "com.pialytic.app",                      label: "Pialytic" },
  "proton-vpn":           { packageName: "ch.protonvpn.android",                  label: "Proton VPN" },
  "proxyman":             { packageName: "me.nickchan.proxyman",                  label: "Proxyman" },
  "psiphon":              { packageName: "com.psiphon3",                          label: "Psiphon" },
  "rar":                  { packageName: "com.rarlab.rar",                        label: "RAR" },
  "sai":                  { packageName: "com.aefyr.sai",                         label: "SAI" },
  "shareit":              { packageName: "com.lenovo.anyshare.gps",               label: "SHAREit" },
  "shexa":                { packageName: "com.shexa.app",                         label: "Shexa" },
  "snipd":                { packageName: "ai.snipd.app",                          label: "Snipd" },
  "social-game-box":      { packageName: "com.gamebox.social",                    label: "Social Game Box" },
  "speedtest":            { packageName: "org.zwanoo.android.speedtest",          label: "Speedtest" },
  "splitwise":            { packageName: "com.Splitwise.SplitwiseMobile",         label: "Splitwise" },
  "tasker":               { packageName: "net.dinglisch.android.taskerm",          label: "Tasker" },
  "terabox":              { packageName: "com.dubox.drive",                       label: "TeraBox" },
  "twt-app":              { packageName: "de.nicidienase.twtapp",                 label: "TWT App" },
  "universal-tv-remote":  { packageName: "sensustech.universal.tv.remote.control", label: "Universal TV Remote" },
  "yatri":                { packageName: "in.tpsc.yatri",                         label: "Yatri" },
  "windscribe":           { packageName: "com.windscribe.vpn",                    label: "Windscribe VPN" },
};

export const appConfigs = externalPatchAppConfigs([
  ["1111-warp",           "1.1.1.1 + WARP",        "com.cloudflare.onedotonedotonedotone"],
  ["adguard-nightly",     "AdGuard Nightly",       "com.adguard.android"],
  ["aida64",              "AIDA64",                "com.finalwire.aida64"],
  ["blocker-hero",         "Blocker Hero",          "com.nicholasregan.blockerhero"],
  ["call-recorder",        "Call Recorder",         "com.appstar.callrecorder"],
  ["canva",                "Canva",                 "com.canva.editor"],
  ["case-tracker",         "Case Tracker",          "com.saldous.casetracker"],
  ["citizen",              "Citizen",               "com.sp0n.citizen"],
  ["cpu-z",                "CPU-Z",                 "com.cpuid.cpu_z"],
  ["crime-radar",          "Crime Radar",           "com.newsbreak.crimeradar"],
  ["flightradar24",        "Flightradar24",         "com.flightradar24free"],
  ["greenify",             "Greenify",              "com.oasisfeng.greenify"],
  ["hibernator",           "Hibernator",            "com.tafayor.hibernator"],
  ["hola-vpn",             "Hola VPN Proxy Plus",   "org.hola.play"],
  ["http-mock",            "HTTP Mock",             "com.shexa.httpmock"],
  ["inscode-autoclicker",  "Inscode Auto Clicker",  "com.inscode.autoclicker"],
  ["kill-apps",            "Kill Apps",             "com.zenzen.killapps"],
  ["m-indicator",          "m-Indicator",           "com.mobond.mindicator"],
  ["mirko",                "Mirko",                 "it.mirko.bus"],
  ["ml-manager",           "ML Manager",            "com.javiersantos.mlmanager.pro"],
  ["myperm",               "MyPerm",                "app.myperm"],
  ["netguard",             "NetGuard",              "eu.faircode.netguard"],
  ["netmonster",           "NetMonster",            "cz.mroczis.netmonster"],
  ["netshare",             "NetShare",              "kha.prog.mikrotik"],
  ["nzb360",               "nzb360",                "com.kevinforeman.nzb360"],
  ["photo-editor",         "Photo Editor",          "com.iudesk.android.photo.editor"],
  ["pialytic",             "Pialytic",              "com.pialytic.app"],
  ["proton-vpn",           "Proton VPN",            "ch.protonvpn.android", {
    apkmirrorOrg: "proton-technologies-ag",
    apkmirrorRepo: "protonvpn-secure-and-free-vpn",
    apkmirrorSlug: "proton-vpn-fast-secure-vpn",
    apkmirrorType: "bundle",
    apkmirrorFallbackArch: "universal",
    apkmirrorDpi: "120-640dpi",
  }],
  ["proxyman",             "Proxyman",              "me.nickchan.proxyman"],
  ["psiphon",              "Psiphon",               "com.psiphon3"],
  ["rar",                  "RAR",                   "com.rarlab.rar"],
  ["sai",                  "SAI",                   "com.aefyr.sai"],
  ["shareit",              "SHAREit",               "com.lenovo.anyshare.gps"],
  ["shexa",                "Shexa",                 "com.shexa.app"],
  ["snipd",                "Snipd",                 "ai.snipd.app"],
  ["social-game-box",      "Social Game Box",       "com.gamebox.social"],
  ["speedtest",            "Speedtest",             "org.zwanoo.android.speedtest"],
  ["splitwise",            "Splitwise",             "com.Splitwise.SplitwiseMobile"],
  ["tasker",               "Tasker",                "net.dinglisch.android.taskerm"],
  ["terabox",              "TeraBox",               "com.dubox.drive"],
  ["twt-app",              "TWT App",               "de.nicidienase.twtapp"],
  ["universal-tv-remote",  "Universal TV Remote",   "sensustech.universal.tv.remote.control"],
  ["yatri",                "Yatri",                 "in.tpsc.yatri"],
  ["windscribe",           "Windscribe VPN",        "com.windscribe.vpn"],
]);

if (isMain) {
  const parsedTargets = parseTargets(env("BUILD_TARGETS") || "1111-warp,nzb360,adguard-nightly,hola-vpn,proton-vpn,terabox,windscribe");

  validateTargets(command, parsedTargets, { supported: RUSHIRANPISE_APPS, family: "Rushiranpise" });

  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "rushiranpise",
    BUILD_TARGETS: parsedTargets.join(","),
    APK_SOURCE: env("APK_SOURCE") || "apkmirror,apkpure",
    APK_VERSION_SOURCE: env("APK_VERSION_SOURCE") || "recommended",
    APK_LATEST_COMPATIBLE_ONLY: env("APK_LATEST_COMPATIBLE_ONLY"),
    APK_FALLBACK_TO_LATEST: env("APK_FALLBACK_TO_LATEST") || "false",
    MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI: env("MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI") || "1",
    // Rushiranpise patch source
    MORPHE_PATCHES_PROVIDER: "github",
    MORPHE_PATCHES_REPO: env("RUSHIRANPISE_PATCHES_REPO") || "rushiranpise/morphe-patches",
    MORPHE_PATCHES_VERSION: env("RUSHIRANPISE_PATCHES_VERSION") || env("MORPHE_PATCHES_VERSION") || "stable",
    MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
    MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: env("MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS") || "1",
    ROOT_ALLOW_OPTIONS_FILE: "1",
  };

  // Route all rushiranpise app option files to config/rushiranpise/
  for (const id of Object.keys(RUSHIRANPISE_APPS)) {
    const prefix = id.replaceAll("-", "_").toUpperCase();
    childEnv[`${prefix}_OPTIONS`] = `config/rushiranpise/${id}-options.json`;
  }

  applyDefaultPatchArgs(childEnv, command);
  runMorphe({ root, command, args, childEnv, builderName: "rushiranpise" });
}
