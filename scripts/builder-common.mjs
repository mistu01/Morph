// Shared scaffolding for the *-builder.mjs wrappers around scripts/morphe.mjs.
// Builders keep their own appConfigs, target maps, and env defaults; this module
// owns the spawn/validate/release-notes plumbing that every wrapper duplicates.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function builderRoot(importMetaUrl) {
  return resolve(dirname(fileURLToPath(importMetaUrl)), "..");
}

export function isMainScript(importMetaUrl) {
  return Boolean(process.argv[1] && (
    resolve(process.argv[1]) === fileURLToPath(importMetaUrl) ||
    resolve(process.argv[1]) === resolve(fileURLToPath(importMetaUrl))
  ));
}

export function env(name) {
  return process.env[name] || "";
}

export function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function parseTargets(raw) {
  return String(raw || "")
    .split(/[,\s;.]+/)
    .map((target) => target.trim().toLowerCase())
    .filter(Boolean);
}

const TARGET_VALIDATED_COMMANDS = new Set(["build", "download", "options", "release-check", "release-notes"]);

function supportsTarget(supported, target) {
  return supported instanceof Set
    ? supported.has(target)
    : Object.prototype.hasOwnProperty.call(supported, target);
}

function supportedTargetNames(supported) {
  return supported instanceof Set ? [...supported] : Object.keys(supported);
}

export function validateTargets(command, targets, { supported, family }) {
  if (!TARGET_VALIDATED_COMMANDS.has(command)) return;

  const unknown = targets.filter((target) => !supportsTarget(supported, target));
  if (unknown.length) {
    console.error(`Unsupported ${family} target(s): ${unknown.join(", ")}`);
    console.error(`Supported ${family} targets: ${supportedTargetNames(supported).join(", ")}`);
    process.exit(1);
  }
}

export function defaultPatchArgs({ forcePatch = true, continueOnError = true, optionsUpdate = false } = {}) {
  const args = [];
  if (forcePatch && truthy(env("FORCE_PATCH") || "true")) args.push("--force");
  if (continueOnError && truthy(env("CONTINUE_ON_ERROR") || "true")) args.push("--continue-on-error");
  if (optionsUpdate && truthy(env("OPTIONS_UPDATE") || "true")) args.push("--options-update");
  return args;
}

export function applyDefaultPatchArgs(childEnv, command, options = {}) {
  if (command === "build" && !env("MORPHE_EXTRA_ARGS_JSON")) {
    childEnv.MORPHE_EXTRA_ARGS_JSON = JSON.stringify(defaultPatchArgs(options));
  }
  return childEnv;
}

export function runMorphe({ root, command, args, childEnv, builderName }) {
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
    console.error(`${builderName}-builder failed to start: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

export function generateReleaseNotes({ root, heading, patchesRepo }) {
  let patchesTag = process.env.PATCHES_VERSION || "latest";
  let patchesUrl = `https://github.com/${patchesRepo}/releases`;
  try {
    const patchesMeta = JSON.parse(fs.readFileSync(join(root, ".cache/tools/patches.json"), "utf8"));
    patchesTag = patchesMeta.tag || patchesTag;
    patchesUrl = patchesMeta.url || `https://github.com/${patchesRepo}/releases/tag/${encodeURIComponent(patchesTag)}`;
  } catch {}

  let cliVersion = process.env.MORPHE_CLI_VERSION || "dev";
  try {
    const cliMeta = JSON.parse(fs.readFileSync(join(root, ".cache/tools/morphe-cli.json"), "utf8"));
    cliVersion = cliMeta.tag || cliVersion;
  } catch {}

  const date = new Date().toUTCString();

  const lines = [
    `## ${heading}`,
    "",
    `- **Patches**: [${patchesRepo} ${patchesTag}](${patchesUrl})`,
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
