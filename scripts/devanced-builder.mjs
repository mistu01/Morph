#!/usr/bin/env node
// De-Vanced builder — wraps morphe.mjs for the RookieEnough/De-Vanced patch repo.
// Patches: https://github.com/RookieEnough/De-Vanced

import {
  applyDefaultPatchArgs,
  builderRoot,
  env,
  generateReleaseNotes,
  isMainScript,
  runMorphe,
} from "./builder-common.mjs";
import { externalPatchAppConfigs, envPath, rootBuild, packageNameOptionsDisabled } from "./morphe.mjs";

const root = builderRoot(import.meta.url);
const command = process.argv[2] || "build";
const args = process.argv.slice(3);
const isMain = isMainScript(import.meta.url);

if (isMain && command === "release-notes") {
  generateReleaseNotes({ root, heading: "De-Vanced Patched Release", patchesRepo: "RookieEnough/De-Vanced" });
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
    options: envPath("GOOGLE_PHOTOS_OPTIONS", rootBuild ? "config/devanced/root/google-photos-options.json" : "config/devanced/google-photos-options.json"),
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
    ["cricbuzz",            "Cricbuzz",              "com.cricbuzz.android",                    {}],
    ["disney-plus",         "Disney+",               "com.disney.disneyplus",                  { apkmirrorOrg: "disney", apkmirrorRepo: "disney" }],
    ["facebook",            "Facebook",              "com.facebook.katana",                     { apkmirrorOrg: "facebook-2", apkmirrorRepo: "facebook", apkmirrorType: "bundle", apkmirrorFallbackArch: "universal", apkmirrorDpi: "nodpi" }],
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
    MESSENGER_APK_VERSION:  env("MESSENGER_APK_VERSION")  || "573.0.0.44.88",
    // Per-app options files
    MESSENGER_OPTIONS:      env("MESSENGER_OPTIONS")      || "config/devanced/messenger-options.json",
    GOOGLE_PHOTOS_OPTIONS:  env("GOOGLE_PHOTOS_OPTIONS")  || "config/devanced/google-photos-options.json",
    THREADS_OPTIONS:        env("THREADS_OPTIONS")        || "config/devanced/threads-options.json",
    TIKTOK_OPTIONS:         env("TIKTOK_OPTIONS")         || "config/devanced/tiktok-options.json",
    FACEBOOK_OPTIONS:       env("FACEBOOK_OPTIONS")       || "config/devanced/facebook-options.json",
    GOOGLE_PHOTOS_ZYGISK_REPO: env("GOOGLE_PHOTOS_ZYGISK_REPO") || "MeowDump/Unlimited-Photos-Storage",
  };

  applyDefaultPatchArgs(childEnv, command, { optionsUpdate: true });
  runMorphe({ root, command, args, childEnv, builderName: "devanced" });
}
