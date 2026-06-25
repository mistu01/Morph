#!/usr/bin/env node
// Rushiranpise builder — wraps morphe.mjs for the rushiranpise/morphe-patches repo.
// Patches: https://github.com/rushiranpise/morphe-patches

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "build";
const args = process.argv.slice(3);

if (command === "release-notes") {
  generateReleaseNotes();
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
  "hola-vpn":             { packageName: "org.hola",                              label: "Hola VPN Proxy Plus" },
  "http-mock":            { packageName: "com.shexa.httpmock",                    label: "HTTP Mock" },
  "inscode-autoclicker":  { packageName: "com.inscode.autoclicker",               label: "Inscode Auto Clicker" },
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
};

const rawTargets = env("BUILD_TARGETS") || "1111-warp,nzb360,adguard-nightly,hola-vpn,proton-vpn,terabox";
const parsedTargets = rawTargets
  .split(/[,\s;.]+/)
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

validateTargets(parsedTargets);

const buildTargets = parsedTargets.join(",");

const childEnv = {
  ...process.env,
  BUILD_TARGETS: buildTargets,
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
  console.error(`rushiranpise-builder failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultPatchArgs() {
  const args = [];
  if (truthy(env("FORCE_PATCH") || "true")) args.push("--force");
  if (truthy(env("CONTINUE_ON_ERROR") || "true")) args.push("--continue-on-error");
  return args;
}

function validateTargets(targets) {
  if (!["build", "download", "options", "release-check", "release-notes"].includes(command)) return;

  const unknown = targets.filter((target) => !RUSHIRANPISE_APPS[target]);
  if (unknown.length) {
    console.error(`Unsupported Rushiranpise target(s): ${unknown.join(", ")}`);
    console.error(`Supported Rushiranpise targets: ${Object.keys(RUSHIRANPISE_APPS).join(", ")}`);
    process.exit(1);
  }
}

function env(name) {
  return process.env[name] || "";
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function generateReleaseNotes() {
  let patchesTag = process.env.PATCHES_VERSION || "latest";
  let patchesUrl = "https://github.com/rushiranpise/morphe-patches/releases";
  try {
    const patchesMeta = JSON.parse(fs.readFileSync(join(root, ".cache/tools/patches.json"), "utf8"));
    patchesTag = patchesMeta.tag || patchesTag;
    patchesUrl = patchesMeta.url || `https://github.com/rushiranpise/morphe-patches/releases/tag/${encodeURIComponent(patchesTag)}`;
  } catch {}

  let cliVersion = process.env.MORPHE_CLI_VERSION || "dev";
  try {
    const cliMeta = JSON.parse(fs.readFileSync(join(root, ".cache/tools/morphe-cli.json"), "utf8"));
    cliVersion = cliMeta.tag || cliVersion;
  } catch {}

  const date = new Date().toUTCString();

  const lines = [
    "## Rushiranpise Patched Release",
    "",
    `- **Patches**: [rushiranpise/morphe-patches ${patchesTag}](${patchesUrl})`,
    `- **Morphe CLI**: ${cliVersion}`,
    `- **Date**: ${date}`,
    "",
    "### Compiled Artifacts",
    "",
  ];

  const apps = {};

  function getApp(id, label) {
    if (!apps[id]) {
      apps[id] = {
        id,
        label: label || id,
        version: "unknown",
        standard: null,
        root: null,
      };
    }
    return apps[id];
  }

  // 1. Read standard APK results
  const outputDir = join(root, "output");
  if (fs.existsSync(outputDir)) {
    fs.readdirSync(outputDir).forEach((file) => {
      if (file.endsWith("-result.json")) {
        try {
          const res = JSON.parse(fs.readFileSync(join(outputDir, file), "utf8"));
          const appObj = getApp(res.app || res.id, res.label);
          if (res.packageVersion) appObj.version = res.packageVersion;
          appObj.standard = res;
        } catch {}
      }
    });
  }

  // 2. Read root APK results (patch stats + failures)
  const rootOutputDir = join(root, "output/root");
  if (fs.existsSync(rootOutputDir)) {
    fs.readdirSync(rootOutputDir).forEach((file) => {
      if (file.endsWith("-result.json")) {
        try {
          const res = JSON.parse(fs.readFileSync(join(rootOutputDir, file), "utf8"));
          const appObj = getApp(res.app || res.id, res.label);
          if (res.packageVersion) appObj.version = res.packageVersion;
          appObj.root = res;
        } catch {}
      }
    });
  }

  // 3. Read root module success metadata
  const rootMetaPath = join(root, "output/root-modules/root-modules.json");
  if (fs.existsSync(rootMetaPath)) {
    try {
      const rootMeta = JSON.parse(fs.readFileSync(rootMetaPath, "utf8"));
      (rootMeta.targets || []).forEach((target) => {
        const appObj = getApp(target.id, target.label);
        if (target.version) appObj.version = target.version;
        appObj.root = {
          ...(appObj.root || {}),
          success: true,
          artifactName: basename(target.module),
        };
      });
    } catch {}
  }

  const appKeys = Object.keys(apps).sort();
  if (appKeys.length === 0) {
    lines.push("_No artifacts were built._");
  } else {
    for (const key of appKeys) {
      const app = apps[key];
      const statusParts = [];

      if (app.standard) {
        if (app.standard.success !== false) {
          const applied = patchesFrom(app.standard.appliedPatches).length;
          const failed = failedPatchesFrom(app.standard.failedPatches).length;
          statusParts.push(`Standard APK (✅ \`${app.standard.artifactName || basename(app.standard.output) || "N/A"}\` | patches: ${applied} succeeded, ${failed} failed)`);
        } else {
          statusParts.push(`Standard APK (❌ Failed: ${app.standard.error || "Unknown error"})`);
        }
      }

      if (app.root) {
        if (app.root.success !== false) {
          const applied = patchesFrom(app.root.appliedPatches).length;
          const failed = failedPatchesFrom(app.root.failedPatches).length;
          statusParts.push(`Magisk Module (✅ \`${app.root.artifactName || "N/A"}\` | patches: ${applied} succeeded, ${failed} failed)`);
        } else {
          statusParts.push(`Magisk Module (❌ Failed: ${app.root.error || "Unknown error"})`);
        }
      }

      if (statusParts.length === 0) {
        lines.push(`- **${app.label}** (\`${app.version}\`): ➖ Not built`);
      } else {
        lines.push(`- **${app.label}** (\`${app.version}\`): ${statusParts.join(" | ")}`);
      }
    }
  }

  lines.push("");
  console.log(lines.join("\n"));
}

function patchesFrom(patches) {
  return Array.isArray(patches)
    ? patches.map(patchName).filter(Boolean)
    : [];
}

function failedPatchesFrom(patches) {
  return Array.isArray(patches)
    ? patches.map((entry) => ({
        name: patchName(entry?.patch),
        reason: firstReasonLine(entry?.reason),
      })).filter((entry) => entry.name)
    : [];
}

function patchName(patch) {
  if (typeof patch === "string") return patch;
  if (patch?.name) return patch.name;
  if (Number.isInteger(patch?.index)) return `#${patch.index}`;
  return "";
}

function firstReasonLine(reason) {
  return String(reason || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}
