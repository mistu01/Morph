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

const isMain = process.argv[1] && (
  resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
);

if (isMain && command === "release-notes") {
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

import { externalPatchAppConfigs, envPath, rootBuild, packageNameOptionsDisabled } from "./morphe.mjs";

export const appConfigs = {
  "google-photos": {
    id: "google-photos",
    label: "Google Photos",
    apkpureName: "Google Photos",
    packageName: "com.google.android.apps.photos",
    apkpureSlug: "google-photos",
    apkpurePage: "https://apkpure.com/google-photos/com.google.android.apps.photos",
    uptodownSlug: "google-photos",
    divxlandSlug: "google-photos",
    apkmirrorOrg: "google-inc",
    apkmirrorRepo: "google-photos",
    apkmirrorType: env("GOOGLE_PHOTOS_APKMIRROR_TYPE") || env("APKMIRROR_TYPE") || "bundle",
    apkmirrorArch: env("GOOGLE_PHOTOS_APKMIRROR_ARCH") || env("APKMIRROR_ARCH") || "arm64-v8a",
    apkmirrorFallbackArch: env("GOOGLE_PHOTOS_APKMIRROR_FALLBACK_ARCH") || env("APKMIRROR_FALLBACK_ARCH") || "universal",
    apkmirrorDpi: env("GOOGLE_PHOTOS_APKMIRROR_DPI") || env("APKMIRROR_DPI") || "120-640dpi",
    patchedPackageName: packageNameOptionsDisabled ? "" : env("GOOGLE_PHOTOS_PATCHED_PACKAGE_NAME"),
    requestedVersion: env("GOOGLE_PHOTOS_APK_VERSION"),
    input: envPath("GOOGLE_PHOTOS_APK", "input/google-photos.apk"),
    url: env("GOOGLE_PHOTOS_APK_URL"),
    output: envPath("GOOGLE_PHOTOS_OUT", rootBuild ? "output/root/google-photos-root.apk" : "output/google-photos-patched.apk"),
    options: envPath("GOOGLE_PHOTOS_OPTIONS", rootBuild ? "config/root/google-photos-options.json" : "config/google-photos-options.json"),
    result: envPath("GOOGLE_PHOTOS_RESULT", rootBuild ? "output/root/google-photos-result.json" : "output/google-photos-result.json"),
    rootModuleId: "mistu_google_photos_root",
    rootModuleName: "Mistu Google Photos Root",
    rootApkPath: "system/product/app/Photos/Photos.apk",
    zygiskRepo: env("GOOGLE_PHOTOS_ZYGISK_REPO") || "MeowDump/Unlimited-Photos-Storage",
    rootModuleTemplate: "config/devanced/templates/google-photos-root-template",
  },
  ...externalPatchAppConfigs([
    ["messenger",           "Messenger",             "com.facebook.orca",                     { apkpureSlug: "messenger" }],
    ["threads",             "Threads",               "com.instagram.barcelona",                 { apkmirrorOrg: "instagram", apkmirrorRepo: "threads-an-instagram-app" }],
    ["tiktok",              "TikTok",                "com.zhiliaoapp.musically",               { apkmirrorOrg: "tiktok-pte-ltd", apkmirrorRepo: "tiktok-including-musical-ly" }],
    ["adobe-photoshopmix",  "Adobe Photoshop Mix",   "com.adobe.photoshopmix",                 {}],
    ["amazon",              "Amazon Shopping",       "com.amazon.mShop.android.shopping",      { apkmirrorOrg: "amazon-mobile-llc", apkmirrorRepo: "amazon-shopping" }],
    ["angulus",             "Angulus",               "com.drinkplusplus.angulus",               {}],
    ["bandcamp",            "Bandcamp",              "com.bandcamp.android",                    { apkmirrorOrg: "bandcamp", apkmirrorRepo: "bandcamp" }],
    ["disney-plus",         "Disney+",               "com.disney.disneyplus",                  { apkmirrorOrg: "disney", apkmirrorRepo: "disney" }],
    ["facebook",            "Facebook",              "com.facebook.katana",                     { apkmirrorOrg: "facebook-2", apkmirrorRepo: "facebook" }],
    ["gmx-mail",            "GMX Mail",              "de.gmx.mobile.android.mail",              {}],
    ["google-news",         "Google News",           "com.google.android.apps.magazines",       { apkmirrorOrg: "google-inc", apkmirrorRepo: "google-news" }],
    ["google-recorder",     "Google Recorder",       "com.google.android.apps.recorder",        { apkmirrorOrg: "google-inc", apkmirrorRepo: "google-recorder" }],
    ["hexedit",             "HexEdit",               "com.myprog.hexedit",                      {}],
    ["icon-pack-studio",    "Icon Pack Studio",      "ginlemon.iconpackstudio",                 {}],
    ["inshorts",            "Inshorts",              "com.nis.app",                             {}],
    ["ir-plus",             "IR+",                   "net.binarymode.android.irplus",           {}],
    ["letterboxd",          "Letterboxd",            "com.letterboxd.letterboxd",               { apkmirrorOrg: "letterboxd-pty-ltd", apkmirrorRepo: "letterboxd" }],
    ["ms-office-lens",      "Microsoft Office Lens", "com.microsoft.office.officelens",         { apkmirrorOrg: "microsoft-corporation", apkmirrorRepo: "microsoft-office-lens-pdf-scanner" }],
    ["nothing-smartcenter", "Nothing Smart Center",  "com.nothing.smartcenter",                 {}],
    ["nu-nl",               "nu.nl",                 "nl.sanomamedia.android.nu",               {}],
    ["peacock",             "Peacock",               "com.peacocktv.peacockandroid",            { apkmirrorOrg: "peacocktv", apkmirrorRepo: "peacock-stream-tv-movies" }],
    ["photomath",           "Photomath",             "com.microblink.photomath",                { apkmirrorOrg: "google-inc", apkmirrorRepo: "photomath" }],
    ["pixiv",               "Pixiv",                 "jp.pxv.android",                          {}],
    ["proton-mail",         "Proton Mail",           "ch.protonmail.android",                   { apkmirrorOrg: "proton-technologies-ag", apkmirrorRepo: "protonmail-encrypted-email" }],
    ["rar",                 "RAR",                   "com.rarlab.rar",                          { apkmirrorOrg: "rarlab", apkmirrorRepo: "rar" }],
    ["soundcloud",          "SoundCloud",            "com.soundcloud.android",                  { apkmirrorOrg: "soundcloud-2", apkmirrorRepo: "soundcloud" }],
    ["strava",              "Strava",                "com.strava",                              { apkmirrorOrg: "strava-inc", apkmirrorRepo: "strava-running-and-cycling-gps" }],
    ["tumblr",              "Tumblr",                "com.tumblr",                              { apkmirrorOrg: "tumblr-inc", apkmirrorRepo: "tumblr" }],
    ["twitch",              "Twitch",                "tv.twitch.android.app",                   { apkmirrorOrg: "twitch-interactive-inc", apkmirrorRepo: "twitch" }],
    ["viber",               "Viber",                 "com.viber.voip",                          { apkmirrorOrg: "viber-media-s-a-r-l", apkmirrorRepo: "viber-messenger" }],
  ])
};

if (isMain) {
  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "devanced",
    BUILD_TARGETS: env("BUILD_TARGETS") || "messenger,google-photos,threads,tiktok,facebook",
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
    ROOT_ALLOW_OPTIONS_FILE: "1",
    MESSENGER_APK_VERSION:  env("MESSENGER_APK_VERSION")  || "550.0.0.45.63",
    // Per-app options files
    MESSENGER_OPTIONS:      env("MESSENGER_OPTIONS")      || "config/devanced/messenger-options.json",
    GOOGLE_PHOTOS_OPTIONS:  env("GOOGLE_PHOTOS_OPTIONS")  || "config/devanced/google-photos-options.json",
    THREADS_OPTIONS:        env("THREADS_OPTIONS")        || "config/devanced/threads-options.json",
    TIKTOK_OPTIONS:         env("TIKTOK_OPTIONS")         || "config/devanced/tiktok-options.json",
    FACEBOOK_OPTIONS:       env("FACEBOOK_OPTIONS")       || "config/devanced/facebook-options.json",
    GOOGLE_PHOTOS_ZYGISK_REPO: env("GOOGLE_PHOTOS_ZYGISK_REPO") || "MeowDump/Unlimited-Photos-Storage",
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultPatchArgs() {
  const args = [];
  if (truthy(env("FORCE_PATCH") || "true")) args.push("--force");
  if (truthy(env("CONTINUE_ON_ERROR") || "true")) args.push("--continue-on-error");
  if (truthy(env("OPTIONS_UPDATE") || "true")) args.push("--options-update");
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
