#!/usr/bin/env node

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

const childEnv = {
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

function generateReleaseNotes() {
  let patchesTag = process.env.PATCHES_VERSION || "latest";
  let patchesUrl = "https://github.com/anddea/revanced-patches/releases";
  try {
    const patchesMeta = JSON.parse(fs.readFileSync(join(root, ".cache/tools/patches.json"), "utf8"));
    patchesTag = patchesMeta.tag || patchesTag;
    patchesUrl = patchesMeta.url || `https://github.com/anddea/revanced-patches/releases/tag/${encodeURIComponent(patchesTag)}`;
  } catch {}

  let cliVersion = process.env.MORPHE_CLI_VERSION || "dev";
  try {
    const cliMeta = JSON.parse(fs.readFileSync(join(root, ".cache/tools/morphe-cli.json"), "utf8"));
    cliVersion = cliMeta.tag || cliVersion;
  } catch {}

  const date = new Date().toUTCString();

  const lines = [
    "## Anddea Patched Release",
    "",
    `- **Patches**: [anddea/revanced-patches ${patchesTag}](${patchesUrl})`,
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
    fs.readdirSync(outputDir).forEach(file => {
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

  // 2. Read root APK results (failures)
  const rootOutputDir = join(root, "output/root");
  if (fs.existsSync(rootOutputDir)) {
    fs.readdirSync(rootOutputDir).forEach(file => {
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
      (rootMeta.targets || []).forEach(target => {
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
