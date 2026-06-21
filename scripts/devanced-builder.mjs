#!/usr/bin/env node
// De-Vanced builder — wraps morphe.mjs for the RookieEnough/De-Vanced patch repo.
// Patches: https://github.com/RookieEnough/De-Vanced

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
// De-Vanced targets — every app supported by RookieEnough/De-Vanced
// Map from short target id → { packageName, label }
// Used for validation / documentation only; morphe.mjs drives the actual build.
// ---------------------------------------------------------------------------
export const DEVANCED_APPS = {
  "messenger":        { packageName: "com.facebook.orca",              label: "Messenger" },
  "google-photos":    { packageName: "com.google.android.apps.photos", label: "Google Photos" },
  "threads":          { packageName: "com.instagram.barcelona",        label: "Threads" },
  "tiktok":           { packageName: "com.zhiliaoapp.musically",       label: "TikTok" },
  // — additional supported apps —
  "adobe-photoshopmix": { packageName: "com.adobe.photoshopmix",                  label: "Adobe Photoshop Mix" },
  "amazon":             { packageName: "com.amazon.mShop.android.shopping",       label: "Amazon Shopping" },
  "angulus":            { packageName: "com.drinkplusplus.angulus",               label: "Angulus" },
  "bandcamp":           { packageName: "com.bandcamp.android",                    label: "Bandcamp" },
  "cricbuzz":           { packageName: "com.cricbuzz.android",                    label: "Cricbuzz" },
  "disney-plus":        { packageName: "com.disney.disneyplus",                   label: "Disney+" },
  "facebook":           { packageName: "com.facebook.katana",                     label: "Facebook" },
  "gmx-mail":           { packageName: "de.gmx.mobile.android.mail",              label: "GMX Mail" },
  "google-news":        { packageName: "com.google.android.apps.magazines",       label: "Google News" },
  "google-recorder":    { packageName: "com.google.android.apps.recorder",        label: "Google Recorder" },
  "hexedit":            { packageName: "com.myprog.hexedit",                      label: "HexEdit" },
  "icon-pack-studio":   { packageName: "ginlemon.iconpackstudio",                 label: "Icon Pack Studio" },
  "inshorts":           { packageName: "com.nis.app",                             label: "Inshorts" },
  "ir-plus":            { packageName: "net.binarymode.android.irplus",            label: "IR+" },
  "letterboxd":         { packageName: "com.letterboxd.letterboxd",               label: "Letterboxd" },
  "ms-office-lens":     { packageName: "com.microsoft.office.officelens",         label: "Microsoft Office Lens" },
  "nothing-smartcenter":{ packageName: "com.nothing.smartcenter",                 label: "Nothing Smart Center" },
  "nu-nl":              { packageName: "nl.sanomamedia.android.nu",               label: "nu.nl" },
  "peacock":            { packageName: "com.peacocktv.peacockandroid",            label: "Peacock" },
  "photomath":          { packageName: "com.microblink.photomath",                label: "Photomath" },
  "pixiv":              { packageName: "jp.pxv.android",                          label: "Pixiv" },
  "proton-mail":        { packageName: "ch.protonmail.android",                   label: "Proton Mail" },
  "rar":                { packageName: "com.rarlab.rar",                          label: "RAR" },
  "soundcloud":         { packageName: "com.soundcloud.android",                  label: "SoundCloud" },
  "strava":             { packageName: "com.strava",                              label: "Strava" },
  "tumblr":             { packageName: "com.tumblr",                              label: "Tumblr" },
  "twitch":             { packageName: "tv.twitch.android.app",                   label: "Twitch" },
  "viber":              { packageName: "com.viber.voip",                          label: "Viber" },
};

const childEnv = {
  ...process.env,
  BUILD_TARGETS: env("BUILD_TARGETS") || "messenger,google-photos,threads,tiktok",
  APK_SOURCE: env("APK_SOURCE") || "apkmirror,apkpure",
  APK_VERSION_SOURCE: env("APK_VERSION_SOURCE") || "recommended",
  APK_LATEST_COMPATIBLE_ONLY: env("APK_LATEST_COMPATIBLE_ONLY"),
  APK_FALLBACK_TO_LATEST: env("APK_FALLBACK_TO_LATEST") || "false",
  MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI: env("MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI") || "1",
  // De-Vanced patch source
  MORPHE_PATCHES_REPO: env("DEVANCED_PATCHES_REPO") || "RookieEnough/De-Vanced",
  MORPHE_PATCHES_VERSION: env("DEVANCED_PATCHES_VERSION") || env("MORPHE_PATCHES_VERSION") || "stable",
  MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
  MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: env("MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS") || "1",
  // Per-app options files
  MESSENGER_OPTIONS:      env("MESSENGER_OPTIONS")      || "config/devanced/messenger-options.json",
  "GOOGLE-PHOTOS_OPTIONS": env("GOOGLE_PHOTOS_OPTIONS") || "config/devanced/google-photos-options.json",
  THREADS_OPTIONS:        env("THREADS_OPTIONS")        || "config/devanced/threads-options.json",
  TIKTOK_OPTIONS:         env("TIKTOK_OPTIONS")         || "config/devanced/tiktok-options.json",
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
  console.error(`devanced-builder failed to start: ${result.error.message}`);
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

function env(name) {
  return process.env[name] || "";
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function generateReleaseNotes() {
  let patchesTag = process.env.PATCHES_VERSION || "latest";
  let patchesUrl = "https://github.com/RookieEnough/De-Vanced/releases";
  try {
    const patchesMeta = JSON.parse(fs.readFileSync(join(root, ".cache/tools/patches.json"), "utf8"));
    patchesTag = patchesMeta.tag || patchesTag;
    patchesUrl = patchesMeta.url || `https://github.com/RookieEnough/De-Vanced/releases/tag/${encodeURIComponent(patchesTag)}`;
  } catch {}

  let cliVersion = process.env.MORPHE_CLI_VERSION || "dev";
  try {
    const cliMeta = JSON.parse(fs.readFileSync(join(root, ".cache/tools/morphe-cli.json"), "utf8"));
    cliVersion = cliMeta.tag || cliVersion;
  } catch {}

  const date = new Date().toUTCString();

  const lines = [
    "## De-Vanced Patched Release",
    "",
    `- **Patches**: [RookieEnough/De-Vanced ${patchesTag}](${patchesUrl})`,
    `- **Morphe CLI**: ${cliVersion}`,
    `- **Date**: ${date}`,
    "",
    "### Compiled Artifacts",
    "",
  ];

  const apps = {};

  function getApp(id, label) {
    if (!apps[id]) {
      apps[id] = { id, label: label || id, version: "unknown", standard: null };
    }
    return apps[id];
  }

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

  const appKeys = Object.keys(apps).sort();
  if (appKeys.length === 0) {
    lines.push("_No artifacts were built._");
  } else {
    lines.push("| App | Version | Artifact | Status | Patches |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const key of appKeys) {
      const app = apps[key];
      if (app.standard) {
        const ok = app.standard.success !== false;
        const applied = (app.standard.appliedPatches || []).length;
        const failed = (app.standard.failedPatches || []).length;
        const status = ok ? "✅ Successful" : `❌ Failed: ${app.standard.error || "Unknown"}`;
        const artifact = app.standard.artifactName || basename(app.standard.output || "") || "N/A";
        lines.push(`| ${app.label} | ${app.version} | \`${artifact}\` | ${status} | ✅ ${applied} / ❌ ${failed} |`);
      } else {
        lines.push(`| ${app.label} | ${app.version} | N/A | ➖ Not built | — |`);
      }
    }
  }

  lines.push("");
  console.log(lines.join("\n"));
}
