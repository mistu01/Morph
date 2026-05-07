#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("-") ? rawArgs.shift() : "build";
const passthroughIndex = rawArgs.indexOf("--");
const commandArgs = passthroughIndex === -1 ? rawArgs : rawArgs.slice(0, passthroughIndex);
const passthroughArgs = passthroughIndex === -1
  ? parseJsonArrayEnv("MORPHE_EXTRA_ARGS_JSON")
  : rawArgs.slice(passthroughIndex + 1);
let selectedPatchReleaseTagPromise = null;
let patchesListPromise = null;

const paths = {
  tools: fromRoot(".cache/tools"),
  tmp: fromRoot(".cache/tmp"),
  apks: fromRoot(".cache/apks"),
  apkpure: fromRoot(".cache/apkpure"),
  input: fromRoot("input"),
  output: fromRoot("output"),
  rootModules: fromRoot("output/root-modules"),
};
const packageNamePatch = "Change package name";
const rootDisabledPatches = new Set([
  "change package name",
  "gmscore support",
  "custom branding",
  "custom branding name for reddit",
]);
const rootEnabledPatches = new Set([
  "disable play store updates",
]);
const packageNamePattern = /^[a-z]\w*(\.[a-z]\w*)+$/;
const rootBuild = truthy(env("ROOT_BUILD"));
const defaultTargets = ["youtube", "youtube-music", "reddit"];
const deRevancedSupportedApps = [
  ["amazon-shopping", { label: "Amazon Shopping", packageName: "com.amazon.mShop.android.shopping" }],
  ["amazon-music", { label: "Amazon Music", packageName: "com.amazon.mp3" }],
  ["angulus", { label: "Angulus", packageName: "com.drinkplusplus.angulus" }],
  ["bandcamp", { label: "Bandcamp", packageName: "com.bandcamp.android" }],
  ["cricbuzz", { label: "Cricbuzz", packageName: "com.cricbuzz.android" }],
  ["disney-plus", { label: "Disney+", packageName: "com.disney.disneyplus" }],
  ["facebook", { label: "Facebook", packageName: "com.facebook.katana" }],
  ["gmx-mail", { label: "GMX Mail", packageName: "de.gmx.mobile.android.mail" }],
  ["google-news", { label: "Google News", packageName: "com.google.android.apps.magazines" }],
  ["google-photos", { label: "Google Photos", packageName: "com.google.android.apps.photos" }],
  ["google-recorder", { label: "Google Recorder", packageName: "com.google.android.apps.recorder" }],
  ["hex-editor", { label: "Hex Editor", packageName: "com.myprog.hexedit" }],
  ["icon-pack-studio", { label: "Icon Pack Studio", packageName: "ginlemon.iconpackstudio" }],
  ["inshorts", { label: "Inshorts", packageName: "com.nis.app" }],
  ["irplus", { label: "irplus", packageName: "net.binarymode.android.irplus" }],
  ["letterboxd", { label: "Letterboxd", packageName: "com.letterboxd.letterboxd" }],
  ["messenger", { label: "Messenger", packageName: "com.facebook.orca" }],
  ["microsoft-lens", { label: "Microsoft Lens", packageName: "com.microsoft.office.officelens" }],
  ["nothing-x", { label: "Nothing X", packageName: "com.nothing.smartcenter" }],
  ["nu-nl", { label: "NU.nl", packageName: "nl.sanomamedia.android.nu" }],
  ["peacock-tv", { label: "Peacock TV", packageName: "com.peacocktv.peacockandroid" }],
  ["photomath", { label: "Photomath", packageName: "com.microblink.photomath" }],
  ["photoshop-mix", { label: "Photoshop Mix", packageName: "com.adobe.photoshopmix", apkpureSlug: "adobe-photoshop-mix" }],
  ["pixiv", { label: "Pixiv", packageName: "jp.pxv.android" }],
  ["proton-mail", { label: "Proton Mail", packageName: "ch.protonmail.android" }],
  ["rar", { label: "RAR", packageName: "com.rarlab.rar" }],
  ["soundcloud", { label: "SoundCloud", packageName: "com.soundcloud.android" }],
  ["strava", { label: "Strava", packageName: "com.strava" }],
  ["threads", { label: "Threads", packageName: "com.instagram.barcelona" }],
  ["tiktok-jp", { label: "TikTok (JP)", packageName: "com.ss.android.ugc.trill", apkpureSlug: "tiktok-jp" }],
  ["tiktok", { label: "TikTok", packageName: "com.zhiliaoapp.musically" }],
  ["tumblr", { label: "Tumblr", packageName: "com.tumblr" }],
  ["twitch", { label: "Twitch", packageName: "tv.twitch.android.app" }],
  ["viber", { label: "Viber", packageName: "com.viber.voip" }],
];
const deRevancedTargetIds = deRevancedSupportedApps.map(([id]) => id);

const appConfigs = {
  youtube: {
    id: "youtube",
    label: "YouTube",
    apkpureName: "YouTube",
    packageName: "com.google.android.youtube",
    apkpureSlug: "youtube-2025",
    apkpurePage: "https://apkpure.com/youtube-2025/com.google.android.youtube",
    apkmirrorOrg: "google-inc",
    apkmirrorRepo: "youtube",
    apkmirrorArch: env("YOUTUBE_APKMIRROR_ARCH") || env("APKMIRROR_ARCH") || "universal",
    apkmirrorFallbackArch: env("YOUTUBE_APKMIRROR_FALLBACK_ARCH") || env("APKMIRROR_FALLBACK_ARCH") || "arm64-v8a",
    apkmirrorDpi: env("YOUTUBE_APKMIRROR_DPI") || env("APKMIRROR_DPI") || "nodpi",
    patchedPackageName: env("YOUTUBE_PATCHED_PACKAGE_NAME") || "com.mistu.android.youtube",
    requestedVersion: env("YOUTUBE_APK_VERSION"),
    input: envPath("YOUTUBE_APK", "input/youtube.apk"),
    url: env("YOUTUBE_APK_URL"),
    output: envPath("YOUTUBE_OUT", rootBuild ? "output/root/youtube-root.apk" : "output/youtube-patched.apk"),
    options: envPath("YOUTUBE_OPTIONS", rootBuild ? "config/root/youtube-options.json" : "config/youtube-options.json"),
    result: envPath("YOUTUBE_RESULT", rootBuild ? "output/root/youtube-result.json" : "output/youtube-result.json"),
    rootModuleId: "mistu_youtube_root",
    rootModuleName: "Mistu YouTube Root",
    rootApkPath: "system/product/app/YouTube/YouTube.apk",
  },
  "youtube-music": {
    id: "youtube-music",
    label: "YouTube Music",
    apkpureName: "YouTube Music",
    packageName: "com.google.android.apps.youtube.music",
    apkpureSlug: "youtube-music",
    apkpurePage: "https://apkpure.com/youtube-music/com.google.android.apps.youtube.music",
    apkmirrorOrg: "google-inc",
    apkmirrorRepo: "youtube-music",
    apkmirrorArch: env("YOUTUBE_MUSIC_APKMIRROR_ARCH") || env("APKMIRROR_ARCH") || "arm64-v8a",
    apkmirrorFallbackArch: env("YOUTUBE_MUSIC_APKMIRROR_FALLBACK_ARCH") || env("APKMIRROR_FALLBACK_ARCH") || "armeabi-v7a",
    apkmirrorDpi: env("YOUTUBE_MUSIC_APKMIRROR_DPI") || env("APKMIRROR_DPI") || "nodpi",
    patchedPackageName: env("YOUTUBE_MUSIC_PATCHED_PACKAGE_NAME") || "com.mistu.android.youtube.music",
    requestedVersion: env("YOUTUBE_MUSIC_APK_VERSION"),
    input: envPath("YOUTUBE_MUSIC_APK", "input/youtube-music.apk"),
    url: env("YOUTUBE_MUSIC_APK_URL"),
    output: envPath("YOUTUBE_MUSIC_OUT", rootBuild ? "output/root/youtube-music-root.apk" : "output/youtube-music-patched.apk"),
    options: envPath("YOUTUBE_MUSIC_OPTIONS", rootBuild ? "config/root/youtube-music-options.json" : "config/youtube-music-options.json"),
    result: envPath("YOUTUBE_MUSIC_RESULT", rootBuild ? "output/root/youtube-music-result.json" : "output/youtube-music-result.json"),
    rootModuleId: "mistu_youtube_music_root",
    rootModuleName: "Mistu YouTube Music Root",
    rootApkPath: "system/product/app/YouTubeMusic/YouTubeMusic.apk",
  },
  reddit: {
    id: "reddit",
    label: "Reddit",
    apkpureName: "Reddit",
    packageName: "com.reddit.frontpage",
    apkpureSlug: "reddit-app",
    apkpurePage: "https://apkpure.com/reddit-app/com.reddit.frontpage",
    apkmirrorOrg: "redditinc",
    apkmirrorRepo: "reddit",
    apkmirrorType: env("REDDIT_APKMIRROR_TYPE") || "bundle",
    apkmirrorArch: env("REDDIT_APKMIRROR_ARCH") || env("APKMIRROR_ARCH") || "universal",
    apkmirrorFallbackArch: env("REDDIT_APKMIRROR_FALLBACK_ARCH") || env("APKMIRROR_FALLBACK_ARCH") || "arm64-v8a",
    apkmirrorDpi: env("REDDIT_APKMIRROR_DPI") || env("APKMIRROR_DPI") || "120-640dpi",
    patchedPackageName: env("REDDIT_PATCHED_PACKAGE_NAME"),
    requestedVersion: env("REDDIT_APK_VERSION"),
    input: envPath("REDDIT_APK", "input/reddit.apk"),
    url: env("REDDIT_APK_URL"),
    output: envPath("REDDIT_OUT", rootBuild ? "output/root/reddit-root.apk" : "output/reddit-patched.apk"),
    options: envPath("REDDIT_OPTIONS", rootBuild ? "config/root/reddit-options.json" : "config/reddit-options.json"),
    result: envPath("REDDIT_RESULT", rootBuild ? "output/root/reddit-result.json" : "output/reddit-result.json"),
    rootModuleId: "mistu_reddit_root",
    rootModuleName: "Mistu Reddit Root",
    rootApkPath: "system/app/Reddit/Reddit.apk",
  },
  twitter: {
    id: "twitter",
    label: "X (Twitter)",
    apkpureName: "X",
    packageName: "com.twitter.android",
    apkpureSlug: "x",
    apkpurePage: "https://apkpure.com/x/com.twitter.android",
    apkmirrorOrg: "x-corp",
    apkmirrorRepo: "x-formerly-twitter",
    apkmirrorType: env("TWITTER_APKMIRROR_TYPE") || "bundle",
    apkmirrorArch: env("TWITTER_APKMIRROR_ARCH") || env("APKMIRROR_ARCH") || "universal",
    apkmirrorFallbackArch: env("TWITTER_APKMIRROR_FALLBACK_ARCH") || env("APKMIRROR_FALLBACK_ARCH") || "arm64-v8a",
    apkmirrorDpi: env("TWITTER_APKMIRROR_DPI") || env("APKMIRROR_DPI") || "nodpi",
    patchedPackageName: env("TWITTER_PATCHED_PACKAGE_NAME"),
    requestedVersion: env("TWITTER_APK_VERSION"),
    input: envPath("TWITTER_APK", "input/twitter.apkm"),
    url: env("TWITTER_APK_URL"),
    output: envPath("TWITTER_OUT", rootBuild ? "output/root/twitter-root.apk" : "output/twitter-patched.apk"),
    options: envPath("TWITTER_OPTIONS", rootBuild ? "config/root/twitter-options.json" : "config/twitter-options.json"),
    result: envPath("TWITTER_RESULT", rootBuild ? "output/root/twitter-result.json" : "output/twitter-result.json"),
    rootModuleId: "mistu_twitter_root",
    rootModuleName: "Mistu X Root",
    rootApkPath: "system/app/Twitter/Twitter.apk",
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    apkpureName: "Instagram",
    packageName: "com.instagram.android",
    apkpureSlug: "instagram",
    apkpurePage: "https://apkpure.com/instagram/com.instagram.android",
    apkmirrorOrg: "instagram",
    apkmirrorRepo: "instagram-instagram",
    apkmirrorType: env("INSTAGRAM_APKMIRROR_TYPE") || "bundle",
    apkmirrorArch: env("INSTAGRAM_APKMIRROR_ARCH") || env("APKMIRROR_ARCH") || "universal",
    apkmirrorFallbackArch: env("INSTAGRAM_APKMIRROR_FALLBACK_ARCH") || env("APKMIRROR_FALLBACK_ARCH") || "arm64-v8a",
    apkmirrorDpi: env("INSTAGRAM_APKMIRROR_DPI") || env("APKMIRROR_DPI") || "nodpi",
    patchedPackageName: env("INSTAGRAM_PATCHED_PACKAGE_NAME"),
    requestedVersion: env("INSTAGRAM_APK_VERSION"),
    input: envPath("INSTAGRAM_APK", "input/instagram.apkm"),
    url: env("INSTAGRAM_APK_URL"),
    output: envPath("INSTAGRAM_OUT", rootBuild ? "output/root/instagram-root.apk" : "output/instagram-patched.apk"),
    options: envPath("INSTAGRAM_OPTIONS", rootBuild ? "config/root/instagram-options.json" : "config/instagram-options.json"),
    result: envPath("INSTAGRAM_RESULT", rootBuild ? "output/root/instagram-result.json" : "output/instagram-result.json"),
    rootModuleId: "mistu_instagram_root",
    rootModuleName: "Mistu Instagram Root",
    rootApkPath: "system/app/Instagram/Instagram.apk",
  },
  ...Object.fromEntries(deRevancedSupportedApps.map(([id, config]) => [id, apkOnlyAppConfig(id, config)])),
};

const targetAliases = {
  "de-revanced": deRevancedTargetIds,
  "de-revanced-all": deRevancedTargetIds,
  derevanced: deRevancedTargetIds,
};

const releaseAssets = {
  cli: {
    repo: "MorpheApp/morphe-cli",
    versionEnv: "MORPHE_CLI_VERSION",
    assetPattern: /^morphe-cli-.+-all\.jar$/,
    output: fromRoot(".cache/tools/morphe-cli.jar"),
    meta: fromRoot(".cache/tools/morphe-cli.json"),
  },
  patches: {
    repo: env("MORPHE_PATCHES_REPO") || "MorpheApp/morphe-patches",
    versionEnv: "MORPHE_PATCHES_VERSION",
    assetPattern: /^patches-.+\.mpp$/,
    output: fromRoot(".cache/tools/patches.mpp"),
    meta: fromRoot(".cache/tools/patches.json"),
    prereleaseKeyword: true,
  },
};

const apkeepTool = {
  repo: "EFForg/apkeep",
  versionEnv: "APKEEP_VERSION",
  output: fromRoot(".cache/tools", process.platform === "win32" ? "apkeep.exe" : "apkeep"),
  meta: fromRoot(".cache/tools/apkeep.json"),
};

function apkOnlyAppConfig(id, config) {
  const envPrefix = envPrefixFor(id);
  const apkpureSlug = config.apkpureSlug || id;
  const rootOutput = `output/root/${id}-root.apk`;
  const standardOutput = `output/${id}-patched.apk`;
  const rootOptions = `config/root/${id}-options.json`;
  const standardOptions = `config/${id}-options.json`;
  const rootResult = `output/root/${id}-result.json`;
  const standardResult = `output/${id}-result.json`;

  return {
    id,
    label: config.label,
    apkpureName: config.apkpureName || config.label,
    packageName: config.packageName,
    apkpureSlug,
    apkpurePage: config.apkpurePage || `https://apkpure.com/${apkpureSlug}/${config.packageName}`,
    apkmirrorOrg: config.apkmirrorOrg,
    apkmirrorRepo: config.apkmirrorRepo,
    apkmirrorType: env(`${envPrefix}_APKMIRROR_TYPE`) || config.apkmirrorType,
    apkmirrorArch: env(`${envPrefix}_APKMIRROR_ARCH`) || env("APKMIRROR_ARCH") || config.apkmirrorArch || "universal",
    apkmirrorFallbackArch: env(`${envPrefix}_APKMIRROR_FALLBACK_ARCH`) || env("APKMIRROR_FALLBACK_ARCH") || config.apkmirrorFallbackArch,
    apkmirrorDpi: env(`${envPrefix}_APKMIRROR_DPI`) || env("APKMIRROR_DPI") || config.apkmirrorDpi || "nodpi",
    patchedPackageName: env(`${envPrefix}_PATCHED_PACKAGE_NAME`),
    requestedVersion: env(`${envPrefix}_APK_VERSION`),
    input: envPath(`${envPrefix}_APK`, `input/${id}.apk`),
    url: env(`${envPrefix}_APK_URL`),
    output: envPath(`${envPrefix}_OUT`, rootBuild ? rootOutput : standardOutput),
    options: envPath(`${envPrefix}_OPTIONS`, rootBuild ? rootOptions : standardOptions),
    result: envPath(`${envPrefix}_RESULT`, rootBuild ? rootResult : standardResult),
    rootModuleId: `mistu_${id.replaceAll("-", "_")}_root`,
    rootModuleName: `Mistu ${config.label} Root`,
    rootApkPath: `system/app/${id}/${id}.apk`,
  };
}

main().catch((error) => {
  console.error(`\nerror: ${error.message}`);
  process.exit(1);
});

async function main() {
  switch (command) {
    case "build":
      await build();
      break;
    case "download":
      await downloadApks({ force: flag("force-download") });
      break;
    case "options":
      await createOptions();
      break;
    case "tools":
      await ensureTools(flag("refresh-tools"));
      break;
    case "versions":
      await printVersions();
      break;
    case "release-notes":
      await printReleaseNotes();
      break;
    case "root-modules":
      await packageRootModules();
      break;
    case "clean":
      clean();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      throw new Error(`Unknown command "${command}". Run "node scripts/morphe.mjs help".`);
  }
}

async function build() {
  checkJava();
  const tools = await ensureTools(flag("refresh-tools"));
  const continueOnError = shouldContinueBuildOnError();
  const failures = [];
  mkdirSync(paths.output, { recursive: true });
  mkdirSync(paths.tmp, { recursive: true });

  for (const app of selectedApps()) {
    try {
      await buildApp(app, tools);
    } catch (error) {
      await writeBuildFailure(app, error);
      if (!continueOnError) throw error;
      failures.push(`${app.label}: ${error.message}`);
      console.warn(`warning: ${app.label} failed: ${error.message}`);
    }
  }

  if (failures.length) {
    console.warn("warning: one or more Morphe targets failed:");
    for (const failure of failures) console.warn(`warning: - ${failure}`);
  }
}

async function buildApp(app, tools) {
  await ensureInput(app);
  await ensurePatchOptions(app, tools);
  const patchArgs = patchArgsFor(app);
  const temporaryFilesPath = fromRoot(`.cache/tmp/${app.id}`);
  mkdirSync(dirname(app.output), { recursive: true });
  mkdirSync(dirname(app.result), { recursive: true });
  mkdirSync(temporaryFilesPath, { recursive: true });

  const args = [
    "-jar",
    tools.cli,
    "patch",
    "--patches",
    tools.patches,
    "--out",
    app.output,
    "--result-file",
    app.result,
    "--temporary-files-path",
    temporaryFilesPath,
    "--purge",
  ];

  appendSigningArgs(args);

  if (existsSync(app.options) && (!rootBuild || truthy(env("ROOT_ALLOW_OPTIONS_FILE")))) {
    args.push("--options-file", app.options);
    if (truthy(env("MORPHE_OPTIONS_UPDATE"))) args.push("--options-update");
  } else if (rootBuild && existsSync(app.options)) {
    console.log(`${app.label}: ignoring ${relative(app.options)} for root build so Morphe default patches stay enabled.`);
  }

  args.push(...patchArgs, app.input);

  console.log(`\n==> Building ${app.label}`);
  run("java", args);
  if (rootBuild) await assertRootPackageName(app);
}

async function writeBuildFailure(app, error) {
  mkdirSync(dirname(app.result), { recursive: true });
  const existing = await readJson(app.result);
  await writeJson(app.result, {
    ...(existing || {}),
    app: app.id,
    label: app.label,
    packageName: existing?.packageName || app.packageName,
    success: false,
    error: existing?.error || error.message,
    input: app.input,
    output: app.output,
    builtAt: existing?.builtAt || new Date().toISOString(),
  });
}

function shouldContinueBuildOnError() {
  return truthy(env("MORPHE_CONTINUE_ON_ERROR")) || passthroughArgs.includes("--continue-on-error");
}

async function assertRootPackageName(app) {
  const result = await readJson(app.result);
  const packageName = result?.packageName;
  if (!packageName) {
    console.warn(`${app.label}: could not verify package name because ${relative(app.result)} is missing packageName.`);
    return;
  }

  if (packageName !== app.packageName) {
    throw new Error(`${app.label}: root APK package name is ${packageName}, expected original package ${app.packageName}. Check root patch options.`);
  }

  console.log(`${app.label}: verified root APK package name ${packageName}.`);
}

async function packageRootModules() {
  checkJava();
  const apps = selectedApps();
  const stagingRoot = fromRoot(".cache/root-modules");
  const versionCode = releaseVersionCode();
  const version = releaseVersionName();

  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(paths.rootModules, { recursive: true });

  const packaged = [];
  for (const app of apps) {
    if (!usableFile(app.output)) {
      throw new Error(`${app.label}: expected patched APK at ${relative(app.output)}. Run the root build first.`);
    }
    if (!usableFile(app.input) || extname(app.input).toLowerCase() !== ".apk") {
      throw new Error(`${app.label}: root modules need the original stock APK at ${relative(app.input)} so the package can be registered before bind mounting.`);
    }

    const moduleDir = join(stagingRoot, app.id);
    createRootModule(moduleDir, {
      id: app.rootModuleId,
      name: app.rootModuleName,
      version,
      versionCode,
      description: `${app.label} root module by mistu. Installs the patched APK with the original package name and detaches Play Store updates.`,
      apps: [app],
    });

    const zip = join(paths.rootModules, `${app.id}-root-module.zip`);
    createZip(moduleDir, zip);
    packaged.push(zip);
    console.log(`${app.label}: root module written to ${relative(zip)}`);
  }

  await writeJson(join(paths.rootModules, "root-modules.json"), {
    generatedAt: new Date().toISOString(),
    rootBuild: true,
    compatibleRootManagers: ["Magisk", "KernelSU", "KernelSU Next", "APatch"],
    installStrategy: {
      registerOriginalPackage: true,
      bindMountPatchedBaseApk: true,
      persistentPatchedApkDir: "/data/adb/mistu-root",
    },
    playStoreDetach: {
      unregisterPlayStoreInstaller: true,
      playStoreDatabaseDetach: "best-effort when sqlite3 is available",
    },
    modules: packaged.map((file) => relative(file)),
    targets: apps.map((app) => ({
      id: app.id,
      label: app.label,
      packageName: app.packageName,
      modulePath: app.rootApkPath,
      apk: relative(app.output),
    })),
  });
}

async function downloadApks({ force = false } = {}) {
  const patchesList = await fetchPatchesList();
  for (const app of selectedApps()) {
    await downloadApkApp(app, { force, patchesList });
  }
}

async function createOptions() {
  checkJava();
  const tools = await ensureTools(flag("refresh-tools"));

  for (const app of selectedApps()) {
    createDefaultOptionsFile(app, tools, { force: true });
    await ensurePatchOptions(app, tools);
  }
}

async function ensureTools(force = false) {
  mkdirSync(paths.tools, { recursive: true });

  const [cli, patches] = await Promise.all([
    downloadReleaseAsset(releaseAssets.cli, force),
    downloadReleaseAsset(releaseAssets.patches, force),
  ]);

  return { cli, patches };
}

async function downloadReleaseAsset(config, force) {
  if (!force && usableFile(config.output)) {
    return config.output;
  }

  const version = env(config.versionEnv) || "latest";
  const release = await githubReleaseForVersion(config.repo, version, {
    prereleaseKeyword: Boolean(config.prereleaseKeyword),
  });
  const asset = release.assets.find((item) => config.assetPattern.test(item.name));

  if (!asset) {
    throw new Error(`No matching release asset found for ${config.repo} ${release.tag_name}`);
  }

  console.log(`Downloading ${config.repo} ${release.tag_name}: ${asset.name}`);
  await downloadFile(asset.browser_download_url, config.output);
  await writeJson(config.meta, {
    repo: config.repo,
    tag: release.tag_name,
    asset: asset.name,
    downloadedAt: new Date().toISOString(),
  });

  return config.output;
}

async function ensureApkeep(force = false) {
  if (!force && usableFile(apkeepTool.output)) {
    return apkeepTool.output;
  }

  const version = env(apkeepTool.versionEnv) || "latest";
  const releaseUrl = version === "latest"
    ? `https://api.github.com/repos/${apkeepTool.repo}/releases/latest`
    : `https://api.github.com/repos/${apkeepTool.repo}/releases/tags/${version}`;
  const release = await githubJson(releaseUrl);
  const assetName = apkeepAssetName();
  const asset = release.assets.find((item) => item.name === assetName);

  if (!asset) {
    throw new Error(`No ${assetName} release asset found for ${apkeepTool.repo} ${release.tag_name}`);
  }

  console.log(`Downloading ${apkeepTool.repo} ${release.tag_name}: ${asset.name}`);
  await downloadFile(asset.browser_download_url, apkeepTool.output);

  if (process.platform !== "win32") {
    chmodSync(apkeepTool.output, 0o755);
  }

  await writeJson(apkeepTool.meta, {
    repo: apkeepTool.repo,
    tag: release.tag_name,
    asset: asset.name,
    downloadedAt: new Date().toISOString(),
  });

  return apkeepTool.output;
}

async function githubReleaseForVersion(repo, version = "latest", { prereleaseKeyword = false } = {}) {
  const normalized = String(version || "latest").toLowerCase();

  if (normalized === "latest" || normalized === "stable") {
    return githubJson(`https://api.github.com/repos/${repo}/releases/latest`);
  }

  if (prereleaseKeyword && ["dev", "pre", "preview", "prerelease", "pre-release"].includes(normalized)) {
    const releases = await githubJson(`https://api.github.com/repos/${repo}/releases?per_page=100`);
    const release = releases.find((item) => !item.draft && item.prerelease);
    if (!release) {
      throw new Error(`No prerelease found for ${repo}`);
    }
    return release;
  }

  return githubJson(`https://api.github.com/repos/${repo}/releases/tags/${normalizeTag(version)}`);
}

async function fetchPatchesList() {
  patchesListPromise ||= (async () => {
    const tag = await selectedPatchReleaseTag();
    return githubJson(`https://raw.githubusercontent.com/${releaseAssets.patches.repo}/${tag}/patches-list.json`);
  })();
  return patchesListPromise;
}

async function selectedPatchReleaseTag() {
  const version = env("MORPHE_PATCHES_VERSION") || "latest";

  selectedPatchReleaseTagPromise ||= (async () => {
    const release = await githubReleaseForVersion(releaseAssets.patches.repo, version, {
      prereleaseKeyword: true,
    });
    return release.tag_name;
  })();
  return selectedPatchReleaseTagPromise;
}

async function printVersions() {
  const patchesRepo = releaseAssets.patches.repo;
  const [cliRelease, patchesRelease, patchesDevRelease, patchesList] = await Promise.all([
    githubJson("https://api.github.com/repos/MorpheApp/morphe-cli/releases/latest"),
    githubReleaseForVersion(patchesRepo, "stable"),
    githubReleaseForVersion(patchesRepo, "dev", { prereleaseKeyword: true }).catch(() => null),
    fetchPatchesList(),
  ]);

  console.log(`Morphe CLI latest: ${cliRelease.tag_name}`);
  console.log(`Morphe patches repo: ${patchesRepo}`);
  console.log(`Morphe patches stable: ${patchesRelease.tag_name}`);
  console.log(`Morphe patches dev: ${patchesDevRelease?.tag_name || "none"}`);
  console.log(`Patch list version: ${patchesList.version}`);

  for (const app of Object.values(appConfigs)) {
    const latest = await inspectApkpureLatest(app).catch((error) => ({ error: error.message }));
    const latestLabel = latest.error
      ? `unknown (${latest.error})`
      : `${latest.version || "unknown"} (${latest.size || "unknown size"})`;
    console.log(`APKPure latest ${app.label}: ${latestLabel}`);
    console.log(`Recommended ${app.label}: ${recommendedVersionFor(app, patchesList) || "unknown"}`);
  }

  const packages = new Map();
  for (const patch of patchesList.patches) {
    for (const [packageName, entry] of allCompatiblePackageEntriesFor(patch)) {
      if (!packages.has(packageName)) packages.set(packageName, new Set());
      for (const version of compatibleVersionsFromEntry(entry)) packages.get(packageName).add(version);
    }
  }

  for (const [packageName, versions] of [...packages.entries()].sort()) {
    console.log(`${packageName}: ${[...versions].sort().reverse().join(", ")}`);
  }
}

async function desiredApkVersion(app, patchesList = null) {
  if (app.requestedVersion) return app.requestedVersion;

  const source = (env("APK_VERSION_SOURCE") || "recommended").toLowerCase();
  if (source === "latest") return "";
  if (source === "recommended") {
    const list = patchesList || await fetchPatchesList();
    const compatible = recommendedVersionsFor(app, list);
    return compatible[0] || "";
  }
  if (/^\d+(?:\.\d+)+$/.test(source)) return source;

  throw new Error(`Unsupported APK_VERSION_SOURCE "${source}". Use recommended, latest, or an explicit version like 20.47.62.`);
}

function recommendedVersionFor(app, patchesList) {
  return recommendedVersionsFor(app, patchesList)[0] || "";
}

function recommendedVersionsFor(app, patchesList) {
  const defaultVersions = compatibleVersionsFor(app, patchesList, { defaultOnly: true });
  return defaultVersions.length ? defaultVersions : compatibleVersionsFor(app, patchesList);
}

function compatibleVersionsFor(app, patchesList, { defaultOnly = false, includeExperimental = includeExperimentalTargets() } = {}) {
  const versions = new Set();

  for (const patch of patchesList?.patches || []) {
    if (defaultOnly && patch?.default !== true) continue;
    for (const entry of compatiblePackageEntriesFor(patch, app)) {
      for (const version of compatibleVersionsFromEntry(entry, { includeExperimental })) versions.add(String(version));
    }
  }

  return [...versions].sort(compareVersions).reverse();
}

async function printReleaseNotes() {
  const apps = selectedApps();
  const cliMeta = await readJson(releaseAssets.cli.meta);
  const patchesMeta = await readJson(releaseAssets.patches.meta);
  const patchArgs = parseJsonArrayEnv("MORPHE_EXTRA_ARGS_JSON");
  const lines = [];

  lines.push(rootBuild ? "Automated root module build." : "Automated patched APK build.");
  lines.push("");
  lines.push("## Build Summary");
  lines.push("");
  lines.push(`- Targets: ${apps.map((app) => app.label).join(", ")}`);
  lines.push(`- Morphe CLI: ${cliMeta?.tag || env("MORPHE_CLI_VERSION") || "latest"}`);
  lines.push(`- Morphe patches repo: ${releaseAssets.patches.repo}`);
  lines.push(`- Morphe patches: ${patchesMeta?.tag || env("MORPHE_PATCHES_VERSION") || "latest"}`);
  lines.push(`- Build variant: ${rootBuild ? "root module" : "standard APK"}`);
  lines.push(`- APK version source: ${env("APK_VERSION_SOURCE") || "recommended"}`);
  lines.push(`- Recommended APK fallback to latest: ${truthy(env("APK_FALLBACK_TO_LATEST")) ? "enabled" : "disabled"}`);
  lines.push(`- Patch args: ${patchArgs.length ? patchArgs.join(" ") : "none"}`);
  if (rootBuild) {
    lines.push("- Root modules: Magisk, KernelSU, and APatch compatible ZIPs.");
  }
  lines.push("");
  lines.push("## App Results");
  lines.push("");

  for (const app of apps) {
    const result = await readJson(app.result);
    const apkMeta = await readApkMetadata(app);
    const apkVersion = result?.packageVersion || apkMeta?.version || "unknown";
    const sourcePackageName = result?.packageName || app.packageName;
    const packageName = rootBuild ? app.packageName : app.patchedPackageName || sourcePackageName;
    const applied = patchesFrom(result?.appliedPatches);
    const failed = failedPatchesFrom(result?.failedPatches);
    const stepFailures = stepFailuresFrom(result?.patchingSteps);
    const buildResult = result
      ? result.success === false ? "completed with patch failures" : "successful"
      : "unknown; result file missing";

    const sourceParts = [];
    if (apkMeta?.source) sourceParts.push(apkSourceLabel(apkMeta.source));
    if (apkMeta?.filename) sourceParts.push(apkMeta.filename);
    if (apkMeta?.fallbackFromVersion) sourceParts.push(`fallback from ${apkMeta.fallbackFromVersion}`);
    if (apkMeta?.forcePatchRequired) sourceParts.push("--force");

    lines.push(`- ${app.label} ${apkVersion}: ${buildResult}; patches ${applied.length} ok, ${failed.length} failed`);
    lines.push(`  - Package: ${packageName}${sourcePackageName !== packageName ? ` (source ${sourcePackageName})` : ""}`);
    if (rootBuild) lines.push(`  - Module path: /${app.rootApkPath}`);
    if (sourceParts.length) lines.push(`  - Source: ${sourceParts.join("; ")}`);
    lines.push(`  - Applied: ${formatPatchList(applied)}`);
    if (failed.length) lines.push(`  - Failed: ${failed.map(formatFailedPatch).join("; ")}`);
    if (stepFailures.length) lines.push(`  - Failed steps: ${stepFailures.join("; ")}`);
  }

  if (patchArgs.includes("--continue-on-error")) {
    lines.push("");
    lines.push("Note: `--continue-on-error` was enabled, so check the workflow artifact JSON when debugging patch failures.");
  }

  console.log(lines.join("\n"));
}

function selectedApps() {
  const explicitTargets = optionValues("target").concat(optionValues("targets"));
  const requestedTargets = (explicitTargets.length
    ? explicitTargets
    : splitTargets(env("BUILD_TARGETS") || defaultTargets.join(",")))
    .filter(Boolean);
  const targets = requestedTargets.flatMap(expandTargetAlias);

  const uniqueTargets = [...new Set(targets)];
  const unknown = uniqueTargets.filter((target) => !appConfigs[target]);
  if (unknown.length) {
    throw new Error(
      `Unknown target(s): ${unknown.join(", ")}. ` +
      `Valid targets: ${Object.keys(appConfigs).join(", ")}. ` +
      `Aliases: ${Object.keys(targetAliases).join(", ")}`,
    );
  }

  return uniqueTargets.map((target) => appConfigs[target]);
}

function expandTargetAlias(target) {
  return targetAliases[target.toLowerCase()] || [target];
}

function apkSources() {
  const raw = env("APK_SOURCE") || "apkpure";
  const expanded = raw.toLowerCase() === "auto" ? "apkmirror,apkpure" : raw;
  const sources = expanded
    .split(/[,\s]+/)
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);
  const uniqueSources = [...new Set(sources.length ? sources : ["apkpure"])];
  const supported = new Set(["apkmirror", "apkpure", "local"]);
  const unknown = uniqueSources.filter((source) => !supported.has(source));

  if (unknown.length) {
    throw new Error(`Unsupported APK_SOURCE value(s): ${unknown.join(", ")}. Use apkmirror, apkpure, local, or auto.`);
  }

  return uniqueSources;
}

function apkSourceLabel(source) {
  const labels = {
    apkmirror: "APKMirror",
    apkpure: "APKPure",
    "apkpure-direct": "APKPure",
    "apkpure-python": "APKPure",
    apkeep: "APKPure/apkeep",
    local: "local input",
  };
  return labels[source] || source || "configured source";
}

async function ensureInput(app) {
  const sources = apkSources();
  const canAutoDownload = sources.some((source) => source !== "local");
  const refreshInput = canAutoDownload && truthy(env("AUTO_UPDATE_APKS"));

  if (existsSync(app.input) && !refreshInput) {
    await applyCachedInputMetadata(app);
    return;
  }

  if (app.url) {
    mkdirSync(dirname(app.input), { recursive: true });
    console.log(`Downloading private input for ${app.label}`);
    await downloadFile(app.url, app.input);
    return;
  }

  if (canAutoDownload) {
    await downloadApkApp(app, { force: refreshInput });
    return;
  }

  throw new Error(
    `${app.label} input is missing. Put it at ${relative(app.input)}, set ${envNameFor(app.id)}_URL, or set APK_SOURCE=apkmirror,apkpure.`,
  );
}

async function applyCachedInputMetadata(app) {
  const metadata = await readApkMetadata(app);
  if (!metadata?.forcePatchRequired) return;
  if (metadata.destination && resolve(metadata.destination) !== resolve(app.input)) return;

  app.forcePatch = true;
  console.log(`${app.label}: cached APK metadata requires --force for patching.`);
}

function patchArgsFor(app) {
  const args = [...passthroughArgs];
  if (app.forcePatch && !args.includes("--force")) {
    console.log(`${app.label}: adding --force because latest APK fallback is being used.`);
    args.push("--force");
  }
  if (rootBuild) args.push(...(app.rootPatchArgs || []));
  return args;
}

async function ensurePatchOptions(app, tools = null) {
  if (rootBuild) {
    await ensureRootPatchArgs(app);
    return;
  }
  await ensurePackageNameOptions(app, tools);
}

async function ensureRootPatchArgs(app) {
  const patchesList = await fetchPatchesList();
  const args = [];
  const disabled = [];
  const enabled = [];

  for (const patch of patchesList?.patches || []) {
    if (!patch?.name || !patchCompatibleWithApp(patch, app)) continue;

    const patchKey = patch.name.toLowerCase();
    if (rootDisabledPatches.has(patchKey)) {
      args.push("--disable", patch.name);
      disabled.push(patch.name);
    } else if (rootEnabledPatches.has(patchKey)) {
      args.push("--enable", patch.name);
      enabled.push(patch.name);
    }
  }

  app.rootPatchArgs = args;

  console.log(`${app.label}: root build keeps original package ${app.packageName}.`);
  if (disabled.length) console.log(`${app.label}: root patch args disable: ${disabled.join(", ")}.`);
  if (enabled.length) console.log(`${app.label}: root patch args enable: ${enabled.join(", ")}.`);
}

async function ensurePackageNameOptions(app, tools = null) {
  if (!app.patchedPackageName) return;
  if (!packageNamePattern.test(app.patchedPackageName)) {
    throw new Error(`${app.label}: invalid patched package name "${app.patchedPackageName}".`);
  }

  if (!existsSync(app.options)) {
    const activeTools = tools || await ensureTools(flag("refresh-tools"));
    createDefaultOptionsFile(app, activeTools);
  }

  const patchesList = await fetchPatchesList();
  const existingBundles = await readJson(app.options);
  const existingBundle = Array.isArray(existingBundles) ? existingBundles[0] : null;
  const patchEntries = {};

  for (const patch of patchesList?.patches || []) {
    if (!patch?.name || !patchCompatibleWithApp(patch, app)) continue;

    const existingEntry = findPatchEntry(existingBundle, patch.name);
    patchEntries[patch.name] = {
      enabled: existingEntry?.enabled ?? Boolean(patch.use),
      options: mergePatchOptions(patch, existingEntry),
    };
  }

  const packageNameEntry = patchEntries[packageNamePatch];
  if (!packageNameEntry) {
    throw new Error(`Morphe patches ${patchesList?.version || ""} did not include "${packageNamePatch}".`);
  }

  packageNameEntry.enabled = true;
  packageNameEntry.options = {
    ...packageNameEntry.options,
    packageName: app.patchedPackageName,
    updatePermissions: true,
    updateProviders: true,
    updateProvidersStrings: true,
  };

  const now = new Date().toISOString();
  await writeJson(app.options, [{
    meta: {
      created_at: existingBundle?.meta?.created_at || now,
      updated_at: now,
      source: `morphe-patches ${patchesList?.version || env("MORPHE_PATCHES_VERSION") || "latest"}`,
    },
    patches: patchEntries,
  }]);

  console.log(`${app.label}: package rename option set to ${app.patchedPackageName}`);
}

function createDefaultOptionsFile(app, tools, { force = false } = {}) {
  if (!force && existsSync(app.options)) return;

  mkdirSync(dirname(app.options), { recursive: true });
  console.log(`\n==> Creating options for ${app.label}`);
  run("java", [
    "-jar",
    tools.cli,
    "options-create",
    "--patches",
    tools.patches,
    "--out",
    app.options,
    "--filter-package-name",
    app.packageName,
  ]);
}

function patchCompatibleWithApp(patch, app) {
  if (!patch.compatiblePackages) return true;
  return compatiblePackageEntriesFor(patch, app).length > 0;
}

function compatiblePackageEntriesFor(patch, app) {
  const compatible = patch?.compatiblePackages;
  if (!compatible) return [];

  if (Array.isArray(compatible)) {
    return compatible.filter((entry) => entry?.packageName === app.packageName);
  }

  if (Object.prototype.hasOwnProperty.call(compatible, app.packageName)) {
    return [compatible[app.packageName]];
  }

  return [];
}

function allCompatiblePackageEntriesFor(patch) {
  const compatible = patch?.compatiblePackages;
  if (!compatible) return [];

  if (Array.isArray(compatible)) {
    return compatible
      .filter((entry) => entry?.packageName)
      .map((entry) => [entry.packageName, entry]);
  }

  return Object.entries(compatible);
}

function compatibleVersionsFromEntry(entry, { includeExperimental = includeExperimentalTargets() } = {}) {
  if (Array.isArray(entry?.targets)) {
    return entry.targets
      .filter((target) => includeExperimental || !(target?.isExperimental || target?.experimental))
      .map((target) => target?.version)
      .filter(Boolean);
  }

  if (Array.isArray(entry)) {
    return entry.filter(Boolean);
  }

  return [];
}

function includeExperimentalTargets() {
  return truthy(env("MORPHE_INCLUDE_EXPERIMENTAL_TARGETS"));
}

function findPatchEntry(bundle, patchName) {
  if (!bundle?.patches) return null;

  const match = Object.entries(bundle.patches)
    .find(([name]) => name.toLowerCase() === patchName.toLowerCase());
  return match?.[1] || null;
}

function mergePatchOptions(patch, existingEntry) {
  const defaults = {};

  for (const option of patch.options || []) {
    if (!option?.key) continue;
    defaults[option.key] = Object.prototype.hasOwnProperty.call(option, "default")
      ? option.default
      : null;
  }

  return {
    ...defaults,
    ...(existingEntry?.options || {}),
  };
}

function createRootModule(moduleDir, { id, name, version, versionCode, description, apps }) {
  rmSync(moduleDir, { recursive: true, force: true });
  mkdirSync(moduleDir, { recursive: true });

  const packageNames = apps.map((app) => app.packageName);
  const entries = apps.map((app) => ({
    ...app,
    stagedPatchedApkName: `${app.id}-patched.apk`,
    stagedStockApkName: `${app.id}-stock.apk`,
    fallbackSystemPath: rootSystemPathFor(app.rootApkPath),
  }));
  writeFileSync(join(moduleDir, "module.prop"), [
    `id=${id}`,
    `name=${name}`,
    `version=${version}`,
    `versionCode=${versionCode}`,
    "author=Mistu",
    `description=${description}`,
    "",
  ].join("\n"));

  writeTextFile(join(moduleDir, "customize.sh"), rootCustomizeScript(entries), 0o755);

  writeTextFile(join(moduleDir, "post-mount.sh"), rootLifecycleScript(entries, "post-mount"), 0o755);
  writeTextFile(join(moduleDir, "service.sh"), rootLifecycleScript(entries, "service"), 0o755);
  writeTextFile(join(moduleDir, "uninstall.sh"), rootUninstallScript(packageNames), 0o755);
  writeMagiskInstaller(moduleDir);
  writeFileSync(join(moduleDir, "system.prop"), [
    "# Module intentionally keeps system properties unchanged.",
    "",
  ].join("\n"));

  writeFileSync(join(moduleDir, "README.md"), [
    `# ${name}`,
    "",
    "Install this ZIP with Magisk, KernelSU, KernelSU Next, or APatch, then reboot.",
    "During installation, the module registers the original package using the stock APK, then bind-mounts the patched APK over the package base APK.",
    "The module re-applies the bind mount and Play Store detach commands at boot.",
    "This keeps the launcher entry tied to the original package while running the patched APK.",
    "",
    "Included apps:",
    ...entries.map((app) => `- ${app.label}: ${app.packageName}`),
    "",
  ].join("\n"));

  for (const app of entries) {
    const patchedDestination = join(moduleDir, "common", "patched", app.stagedPatchedApkName);
    const stockDestination = join(moduleDir, "common", "stock", app.stagedStockApkName);
    mkdirSync(dirname(patchedDestination), { recursive: true });
    mkdirSync(dirname(stockDestination), { recursive: true });
    copyFileSync(app.output, patchedDestination);
    copyFileSync(app.input, stockDestination);
  }
}

function rootCustomizeScript(apps) {
  const appLines = apps.map((app) => [
    app.packageName,
    app.label,
    app.stagedPatchedApkName,
    app.stagedStockApkName,
    app.fallbackSystemPath,
  ].join("|"));

  return [
    "#!/system/bin/sh",
    "",
    "command -v ui_print >/dev/null 2>&1 || ui_print() { echo \"$@\"; }",
    "command -v abort >/dev/null 2>&1 || abort() { ui_print \"! $*\"; exit 1; }",
    "",
    "ui_print \"\"",
    "ui_print \"*******************************\"",
    "ui_print \"  $MODNAME\"",
    "ui_print \"  by mistu\"",
    "ui_print \"*******************************\"",
    "ui_print \"\"",
    "ui_print \"- Root managers: Magisk, KernelSU, KernelSU Next, APatch\"",
    "ui_print \"- Package mode: original package names\"",
    "ui_print \"- Install mode: stock package registration + patched base.apk bind mount\"",
    "ui_print \"- Play Store: detach installer/database ownership\"",
    "ui_print \"- Legacy replace file: not used\"",
    "ui_print \"\"",
    "",
    "APP_LIST=$(cat <<'EOF_APP_LIST'",
    ...appLines,
    "EOF_APP_LIST",
    ")",
    "",
    "DATA_DIR=/data/adb/mistu-root/${MODPATH##*/}",
    "mkdir -p \"$DATA_DIR\"",
    "",
    "pmex() {",
    "  local out",
    "  out=\"$(pm \"$@\" 2>&1 </dev/null)\"",
    "  local status=$?",
    "  printf '%s\\n' \"$out\"",
    "  return $status",
    "}",
    "",
    "pm_base_path() {",
    "  pm path \"$1\" 2>/dev/null | sed -n 's/^package://p' | grep '/base\\.apk$' | head -n 1",
    "}",
    "",
    "uninstall_system_updates_if_needed() {",
    "  local pkg=\"$1\" flags",
    "  flags=\"$(dumpsys package \"$pkg\" 2>/dev/null | grep -m1 'pkgFlags=')\"",
    "  if printf '%s\\n' \"$flags\" | grep -Fq UPDATED_SYSTEM_APP; then",
    "    ui_print \"  Removing Play Store system update overlay\"",
    "    pmex uninstall-system-updates \"$pkg\" >/dev/null 2>&1 || true",
    "  fi",
    "}",
    "",
    "set_pm_installer() {",
    "  cmd package set-installer \"$1\" com.android.shell >/dev/null 2>&1 || true",
    "  pm set-installer \"$1\" com.android.shell >/dev/null 2>&1 || true",
    "}",
    "",
    "enable_package() {",
    "  cmd package install-existing --user 0 \"$1\" >/dev/null 2>&1 || true",
    "  pm enable \"$1\" >/dev/null 2>&1 || true",
    "  cmd package unsuspend \"$1\" >/dev/null 2>&1 || true",
    "}",
    "",
    "install_stock_package() {",
    "  local pkg=\"$1\" label=\"$2\" stock_apk=\"$3\"",
    "  local size session out verify_adb package_verifier",
    "  [ -f \"$stock_apk\" ] || abort \"Missing stock APK for $label: $stock_apk\"",
    "  uninstall_system_updates_if_needed \"$pkg\"",
    "  if [ -n \"$(pm_base_path \"$pkg\")\" ]; then",
    "    enable_package \"$pkg\"",
    "    return 0",
    "  fi",
    "  ui_print \"  Registering original package with stock APK\"",
    "  size=\"$(wc -c < \"$stock_apk\")\"",
    "  verify_adb=\"$(settings get global verifier_verify_adb_installs 2>/dev/null)\"",
    "  package_verifier=\"$(settings get global package_verifier_enable 2>/dev/null)\"",
    "  settings put global verifier_verify_adb_installs 0 >/dev/null 2>&1 || true",
    "  settings put global package_verifier_enable 0 >/dev/null 2>&1 || true",
    "  out=\"$(pm install-create --user 0 -i com.android.vending -r -S \"$size\" 2>&1)\" || { settings put global verifier_verify_adb_installs \"$verify_adb\" >/dev/null 2>&1 || true; settings put global package_verifier_enable \"$package_verifier\" >/dev/null 2>&1 || true; ui_print \"$out\"; abort \"install-create failed for $label\"; }",
    "  session=\"${out#*[}\"",
    "  session=\"${session%]*}\"",
    "  out=\"$(pm install-write -S \"$size\" \"$session\" base.apk \"$stock_apk\" 2>&1)\" || { pm install-abandon \"$session\" >/dev/null 2>&1 || true; settings put global verifier_verify_adb_installs \"$verify_adb\" >/dev/null 2>&1 || true; settings put global package_verifier_enable \"$package_verifier\" >/dev/null 2>&1 || true; ui_print \"$out\"; abort \"install-write failed for $label\"; }",
    "  out=\"$(pm install-commit \"$session\" 2>&1)\" || { settings put global verifier_verify_adb_installs \"$verify_adb\" >/dev/null 2>&1 || true; settings put global package_verifier_enable \"$package_verifier\" >/dev/null 2>&1 || true; ui_print \"$out\"; abort \"install-commit failed for $label\"; }",
    "  settings put global verifier_verify_adb_installs \"$verify_adb\" >/dev/null 2>&1 || true",
    "  settings put global package_verifier_enable \"$package_verifier\" >/dev/null 2>&1 || true",
    "  enable_package \"$pkg\"",
    "}",
    "",
    "mount_bind_global() {",
    "  local source=\"$1\" target=\"$2\" out",
    "  if su -M -c true >/dev/null 2>&1; then",
    "    out=\"$(su -M -c \"mount -o bind '$source' '$target'\" 2>&1)\" || { ui_print \"$out\"; return 1; }",
    "  elif command -v nsenter >/dev/null 2>&1; then",
    "    out=\"$(nsenter -t 1 -m mount -o bind \"$source\" \"$target\" 2>&1)\" || { ui_print \"$out\"; return 1; }",
    "  else",
    "    out=\"$(mount -o bind \"$source\" \"$target\" 2>&1)\" || { ui_print \"$out\"; return 1; }",
    "  fi",
    "}",
    "",
    "install_root_apk() {",
    "  local pkg=\"$1\" label=\"$2\" patched_name=\"$3\" stock_name=\"$4\" fallback_path=\"$5\"",
    "  local patched_apk stock_apk persistent_apk target_path",
    "  patched_apk=\"$MODPATH/common/patched/$patched_name\"",
    "  stock_apk=\"$MODPATH/common/stock/$stock_name\"",
    "  persistent_apk=\"$DATA_DIR/$pkg.apk\"",
    "  [ -f \"$patched_apk\" ] || abort \"Missing patched APK for $label: $patched_apk\"",
    "",
    "  ui_print \"- App: $label\"",
    "  ui_print \"  Package: $pkg\"",
    "  install_stock_package \"$pkg\" \"$label\" \"$stock_apk\"",
    "  target_path=\"$(pm_base_path \"$pkg\")\"",
    "  [ -n \"$target_path\" ] || abort \"Package path not found after stock registration for $label\"",
    "  cp -f \"$patched_apk\" \"$persistent_apk\"",
    "  chmod 0644 \"$persistent_apk\"",
    "  chcon u:object_r:apk_data_file:s0 \"$persistent_apk\" >/dev/null 2>&1 || true",
    "  mount_bind_global \"$persistent_apk\" \"$target_path\" || abort \"Bind mount failed for $label\"",
    "  set_pm_installer \"$pkg\"",
    "  am force-stop \"$pkg\" >/dev/null 2>&1 || true",
    "  cmd package compile -m speed-profile -f \"$pkg\" >/dev/null 2>&1 || true",
    "  ui_print \"  Stock base: $target_path\"",
    "  ui_print \"  Patched base: $persistent_apk\"",
    "}",
    "",
    "while IFS='|' read -r pkg label patched_name stock_name fallback_path; do",
    "  [ -n \"$pkg\" ] || continue",
    "  install_root_apk \"$pkg\" \"$label\" \"$patched_name\" \"$stock_name\" \"$fallback_path\"",
    "done <<EOF_INSTALL_APPS",
    "$APP_LIST",
    "EOF_INSTALL_APPS",
    "",
    "rm -rf \"$MODPATH/common\"",
    "ui_print \"\"",
    "ui_print \"- Install files prepared successfully\"",
    "ui_print \"- Reboot is required\"",
    "ui_print \"\"",
    "",
  ].join("\n");
}

function rootLifecycleScript(apps, stage) {
  const appLines = apps.map((app) => [
    app.packageName,
    app.label,
  ].join("|"));
  const waitForBoot = stage === "service"
    ? [
        "boot_wait() {",
        "  local boot_completed",
        "  for _ in $(seq 1 60); do",
        "    boot_completed=\"$(getprop sys.boot_completed 2>/dev/null)\"",
        "    [ \"$boot_completed\" = \"1\" ] && return 0",
        "    sleep 2",
        "  done",
        "}",
        "",
        "boot_wait",
      ]
    : [];

  return [
    "#!/system/bin/sh",
    "",
    "MODDIR=${0%/*}",
    "LOG=\"$MODDIR/root-module.log\"",
    "DATA_DIR=/data/adb/mistu-root/${MODDIR##*/}",
    "ORIG_PROP=\"$MODDIR/module.prop.orig\"",
    "PLAY_STORE=com.android.vending",
    "APP_LIST=$(cat <<'EOF_APP_LIST'",
    ...appLines,
    "EOF_APP_LIST",
    ")",
    "",
    "log() {",
    "  echo \"$(date '+%Y-%m-%d %H:%M:%S') [$1] $2\" >> \"$LOG\"",
    "}",
    "",
    "set_description_status() {",
    "  local status=\"$1\"",
    "  local base_description description_tmp",
    "  [ -f \"$ORIG_PROP\" ] || cp \"$MODDIR/module.prop\" \"$ORIG_PROP\" >/dev/null 2>&1 || true",
    "  [ -f \"$ORIG_PROP\" ] && cp \"$ORIG_PROP\" \"$MODDIR/module.prop\" >/dev/null 2>&1 || true",
    "  base_description=\"$(sed -n 's/^description=//p' \"$ORIG_PROP\" 2>/dev/null | head -n 1)\"",
    "  base_description=\"${base_description%% | Status: *}\"",
    "  [ -n \"$base_description\" ] || base_description=\"Mistu root module\"",
    "  if [ -f \"$MODDIR/module.prop\" ]; then",
    "    description_tmp=\"$MODDIR/module.prop.tmp\"",
    "    awk -v description=\"$base_description | Status: $status\" '",
    "      BEGIN { updated = 0 }",
    "      /^description=/ { print \"description=\" description; updated = 1; next }",
    "      { print }",
    "      END { if (!updated) print \"description=\" description }",
    "    ' \"$MODDIR/module.prop\" > \"$description_tmp\" && mv \"$description_tmp\" \"$MODDIR/module.prop\"",
    "    rm -f \"$description_tmp\" >/dev/null 2>&1 || true",
    "  fi",
    "}",
    "",
    ...waitForBoot,
    "",
    "pm_base_path() {",
    "  pm path \"$1\" 2>/dev/null | sed -n 's/^package://p' | grep '/base\\.apk$' | head -n 1",
    "}",
    "",
    "mount_bind_global() {",
    "  local source=\"$1\" target=\"$2\"",
    "  if su -M -c true >/dev/null 2>&1; then",
    "    su -M -c \"mount -o bind '$source' '$target'\" >/dev/null 2>&1 && return 0",
    "  fi",
    "  if command -v nsenter >/dev/null 2>&1; then",
    "    nsenter -t 1 -m mount -o bind \"$source\" \"$target\" >/dev/null 2>&1 && return 0",
    "  fi",
    "  mount -o bind \"$source\" \"$target\" >/dev/null 2>&1",
    "}",
    "",
    "apply_package() {",
    "  local pkg=\"$1\" label=\"$2\" patched_apk target_path",
    "  patched_apk=\"$DATA_DIR/$pkg.apk\"",
    "  [ -f \"$patched_apk\" ] || { log \"warn\" \"$label patched APK missing at $patched_apk\"; set_description_status \"Needs reinstall: $label patched APK missing\"; return 0; }",
    "  cmd package install-existing \"$pkg\" >/dev/null 2>&1 || true",
    "  pm enable \"$pkg\" >/dev/null 2>&1 || true",
    "  cmd package unsuspend \"$pkg\" >/dev/null 2>&1 || true",
    "  target_path=\"$(pm_base_path \"$pkg\")\"",
    "  [ -n \"$target_path\" ] || { log \"warn\" \"$label package path not found\"; set_description_status \"Needs reinstall: $label package path not found\"; return 0; }",
    "  if ! mount_bind_global \"$patched_apk\" \"$target_path\"; then",
    "    log \"warn\" \"$label bind mount failed for $target_path\"",
    "    set_description_status \"Needs reinstall: $label bind mount failed\"",
    "    return 0",
    "  fi",
    "  cmd package set-installer \"$pkg\" com.android.shell >/dev/null 2>&1 || true",
    "  pm set-installer \"$pkg\" com.android.shell >/dev/null 2>&1 || true",
    "  cmd package compile -m speed-profile -f \"$pkg\" >/dev/null 2>&1 || true",
    "}",
    "",
    "detach_play_store_db() {",
    "  command -v sqlite3 >/dev/null 2>&1 || return 0",
    "  [ -d /data/data/$PLAY_STORE/databases ] || return 0",
    "",
    "  local pkg label db",
    "  while IFS='|' read -r pkg label; do",
    "    [ -n \"$pkg\" ] || continue",
    "    for db in /data/data/$PLAY_STORE/databases/*.db; do",
    "      [ -f \"$db\" ] || continue",
    "      sqlite3 \"$db\" \"DELETE FROM ownership WHERE doc_id='$pkg' OR package_name='$pkg' OR packageName='$pkg';\" >/dev/null 2>&1 || true",
    "      sqlite3 \"$db\" \"DELETE FROM auto_update WHERE doc_id='$pkg' OR package_name='$pkg' OR packageName='$pkg';\" >/dev/null 2>&1 || true",
    "      sqlite3 \"$db\" \"DELETE FROM appstate WHERE package_name='$pkg' OR packageName='$pkg';\" >/dev/null 2>&1 || true",
    "      sqlite3 \"$db\" \"UPDATE localappstate SET auto_update=0 WHERE package_name='$pkg' OR packageName='$pkg';\" >/dev/null 2>&1 || true",
    "      sqlite3 \"$db\" \"UPDATE local_app_state SET auto_update=0 WHERE package_name='$pkg' OR packageName='$pkg';\" >/dev/null 2>&1 || true",
    "    done",
    "  done <<EOF_DETACH_APPS",
    "$APP_LIST",
    "EOF_DETACH_APPS",
    "}",
    "",
    "while IFS='|' read -r pkg label; do",
    "  [ -n \"$pkg\" ] || continue",
    "  apply_package \"$pkg\" \"$label\"",
    "done <<EOF_APPLY_APPS",
    "$APP_LIST",
    "EOF_APPLY_APPS",
    "detach_play_store_db",
    "set_description_status \"Active: patched APK bind-mounted over original package\"",
    "log \"ok\" \"Applied root module bind mounts and Play Store detach.\"",
    "",
  ].join("\n");
}

function rootUninstallScript(packageNames) {
  return [
    "#!/system/bin/sh",
    "MODDIR=${0%/*}",
    "DATA_DIR=/data/adb/mistu-root/${MODDIR##*/}",
    `PACKAGES="${packageNames.join(" ")}"`,
    "for pkg in $PACKAGES; do",
    "  cmd package set-installer \"$pkg\" com.android.vending >/dev/null 2>&1 || true",
    "  pm set-installer \"$pkg\" com.android.vending >/dev/null 2>&1 || true",
    "done",
    "rm -rf \"$DATA_DIR\"",
    "",
  ].join("\n");
}

function rootSystemPathFor(modulePath) {
  const normalized = modulePath.replaceAll("\\", "/");
  if (normalized.startsWith("system/product/")) return `/${normalized.slice("system/".length)}`;
  if (normalized.startsWith("system/system_ext/")) return `/${normalized.slice("system/".length)}`;
  if (normalized.startsWith("system/vendor/")) return `/${normalized.slice("system/".length)}`;
  if (normalized.startsWith("system/")) return `/${normalized}`;
  return `/${normalized}`;
}

function writeTextFile(file, content, mode = 0o644) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, { mode });
  chmodSync(file, mode);
}

function writeMagiskInstaller(moduleDir) {
  const metaInf = join(moduleDir, "META-INF", "com", "google", "android");
  writeTextFile(join(metaInf, "updater-script"), "#MAGISK\n", 0o644);
  writeTextFile(join(metaInf, "update-binary"), [
    "#!/sbin/sh",
    "",
    "umask 022",
    "ui_print() { echo \"$1\"; }",
    "",
    "OUTFD=$2",
    "ZIPFILE=$3",
    "",
    "mount /data 2>/dev/null",
    "if [ ! -f /data/adb/magisk/util_functions.sh ]; then",
    "  ui_print \"Magisk v25.2+ installer environment was not found.\"",
    "  exit 1",
    "fi",
    "",
    ". /data/adb/magisk/util_functions.sh",
    "if [ \"$MAGISK_VER_CODE\" -lt 25200 ]; then",
    "  ui_print \"Please install Magisk v25.2 or newer.\"",
    "  exit 1",
    "fi",
    "",
    "install_module",
    "exit 0",
    "",
  ].join("\n"), 0o755);
}

function createZip(sourceDir, destination) {
  rmSync(destination, { force: true });
  mkdirSync(dirname(destination), { recursive: true });
  const zip = spawnSync("zip", ["-v"], { stdio: "ignore" });
  if (!zip.error && zip.status === 0) {
    const result = spawnSync("zip", ["-r", "-9", destination, "."], {
      cwd: sourceDir,
      env: process.env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`zip exited with status ${result.status}`);
    return;
  }

  run("jar", ["--create", "--file", destination, "-C", sourceDir, "."]);
}

function releaseVersionName() {
  return env("ROOT_MODULE_VERSION") || new Date().toISOString().slice(0, 10);
}

function releaseVersionCode() {
  const explicit = env("ROOT_MODULE_VERSION_CODE");
  if (explicit) return explicit;
  return String(Math.floor(Date.now() / 1000));
}

async function downloadApkApp(app, { force = false, patchesList = null } = {}) {
  const sources = apkSources().filter((source) => source !== "local");
  if (!sources.length) {
    throw new Error(`${app.label}: APK_SOURCE does not include a downloadable source.`);
  }

  mkdirSync(paths.apks, { recursive: true });
  mkdirSync(dirname(app.input), { recursive: true });

  const desiredVersion = await desiredApkVersion(app, patchesList);
  const metadataFile = metadataFileFor(app);
  const existing = await readApkMetadata(app);

  if (desiredVersion) {
    const exactErrors = [];
    for (const source of sources) {
      try {
        return await downloadExactApkFromSource(source, app, {
          selectedVersion: desiredVersion,
          force,
          patchesList,
          metadataFile,
          existing,
          desiredVersion,
        });
      } catch (error) {
        exactErrors.push(`${apkSourceLabel(source)}: ${error.message}`);
      }
    }

    if (!shouldFallbackToLatest(app)) {
      throw new Error(`${app.label}: exact APK ${desiredVersion} could not be downloaded. ${exactErrors.join(" | ")}`);
    }

    const fallbackReason = exactErrors.join(" | ");
    console.warn(`${app.label}: exact APK ${desiredVersion} could not be downloaded from configured sources: ${fallbackReason}`);
    console.warn(`${app.label}: falling back to the latest available APK and enabling --force for patching.`);
    app.forcePatch = true;
    return downloadLatestApkFromSources(app, {
      sources,
      force: true,
      patchesList,
      metadataFile,
      existing,
      desiredVersion,
      fallbackReason,
    });
  }

  return downloadLatestApkFromSources(app, { sources, force, patchesList, metadataFile, existing, desiredVersion });
}

function shouldFallbackToLatest(app) {
  return !app.requestedVersion
    && (env("APK_VERSION_SOURCE") || "recommended").toLowerCase() === "recommended"
    && truthy(env("APK_FALLBACK_TO_LATEST"));
}

async function downloadExactApkFromSource(source, app, options) {
  if (source === "apkmirror") return downloadWithPythonApkmirror(app, options);
  if (source === "apkpure") return downloadWithPythonApkpure(app, options);
  throw new Error(`Unsupported APK source "${source}"`);
}

async function downloadLatestApkFromSources(
  app,
  { sources, force = false, patchesList = null, metadataFile, existing, desiredVersion = "", fallbackReason = "" },
) {
  const latestErrors = [];

  for (const source of sources) {
    try {
      if (source === "apkmirror") {
        return await downloadWithPythonApkmirror(app, {
          selectedVersion: "",
          force,
          patchesList,
          metadataFile,
          existing,
          desiredVersion,
          fallbackFromVersion: fallbackReason ? desiredVersion : "",
          fallbackReason,
          forcePatchRequired: Boolean(fallbackReason),
        });
      }

      if (source === "apkpure") {
        return await downloadApkpureLatestApp(app, {
          force,
          metadataFile,
          existing,
          desiredVersion,
          fallbackReason,
        });
      }

      throw new Error(`Unsupported APK source "${source}"`);
    } catch (error) {
      latestErrors.push(`${apkSourceLabel(source)}: ${error.message}`);
    }
  }

  throw new Error(`${app.label}: latest APK could not be downloaded from configured sources. ${latestErrors.join(" | ")}`);
}

async function downloadApkpureLatestApp(app, { force = false, metadataFile, existing, desiredVersion = "", fallbackReason = "" }) {
  const selected = await inspectApkpureLatest(app);

  if (
    !force &&
    existsSync(app.input) &&
    String(existing?.source || "").startsWith("apkpure") &&
    selected.version &&
    existing?.version === selected.version &&
    existing?.destination === app.input
  ) {
    console.log(`${app.label} ${selected.version} already downloaded at ${relative(app.input)}`);
    return;
  }

  if (!force && existsSync(app.input) && !existing?.version) {
    console.log(`${app.label} input already exists at ${relative(app.input)}; keeping it. Use --force-download or AUTO_UPDATE_APKS=1 to refresh.`);
    return;
  }

  return downloadApkpureDirectLatestApp(app, {
    selected,
    metadataFile,
    desiredVersion,
    fallbackFromVersion: fallbackReason ? desiredVersion : "",
    fallbackReason,
    forcePatchRequired: Boolean(fallbackReason),
  });
}

async function downloadApkpureDirectLatestApp(
  app,
  {
    selected,
    metadataFile,
    desiredVersion = "",
    fallbackFromVersion = "",
    fallbackReason = "",
    forcePatchRequired = false,
  },
) {
  const extension = extname(selected.filename || "").toLowerCase() || ".apk";
  const destination = replaceExtension(app.input, extension);
  const directUrl = apkpureDownloadUrl(app);

  console.log(`Downloading APKPure ${app.label} latest with direct APKPure endpoint`);
  rmSync(destination, { force: true });
  await downloadFile(directUrl, destination, apkpureHeaders());
  app.input = destination;

  const list = await fetchPatchesList();
  const topRecommendedVersion = recommendedVersionFor(app, list);
  const compatible = compatibleVersionsFor(app, list);

  await writeJson(metadataFile, {
    app: app.id,
    packageName: app.packageName,
    sourcePage: app.apkpurePage,
    source: "apkpure-direct",
    directUrl,
    destination,
    version: selected.version,
    fileType: extension.replace(/^\./, "").toUpperCase(),
    desiredVersion,
    fallbackFromVersion,
    fallbackReason,
    forcePatchRequired,
    morpheTopRecommendedVersion: topRecommendedVersion,
    availableCompatibleVersions: [],
    filename: selected.filename || basename(destination),
    size: selected.size,
    downloadedAt: new Date().toISOString(),
  });
}

async function downloadWithPythonApkmirror(
  app,
  {
    selectedVersion = "",
    force = false,
    patchesList = null,
    metadataFile,
    existing,
    desiredVersion = "",
    fallbackFromVersion = "",
    fallbackReason = "",
    forcePatchRequired = false,
  },
) {
  if (!app.apkmirrorOrg || !app.apkmirrorRepo) {
    throw new Error(`${app.label}: APKMirror metadata is not configured.`);
  }

  const requestedLabel = selectedVersion || "latest";

  if (
    !force &&
    existing?.source === "apkmirror" &&
    existing?.destination &&
    existsSync(existing.destination) &&
    (selectedVersion ? existing?.version === selectedVersion : true)
  ) {
    app.input = existing.destination;
    console.log(`${app.label} ${existing.version || requestedLabel} already downloaded from APKMirror at ${relative(app.input)}`);
    return;
  }

  const outputDir = fromRoot(".cache/apkmirror", app.id);
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const apkmirrorType = app.apkmirrorType || "apk";
  const apkmirrorExtension = apkmirrorType === "bundle" ? "apkm" : "apk";

  console.log(`Downloading APKMirror ${app.label} ${requestedLabel} (${apkmirrorType}, ${app.apkmirrorArch}/${app.apkmirrorDpi})`);
  const metadata = runPythonJson([
    fromRoot("scripts/apkmirror_download.py"),
    "--app-name",
    app.label,
    "--package-name",
    app.packageName,
    "--org",
    app.apkmirrorOrg,
    "--repo",
    app.apkmirrorRepo,
    "--out-dir",
    outputDir,
    "--version",
    requestedLabel,
    "--arch",
    app.apkmirrorArch,
    "--dpi",
    app.apkmirrorDpi,
    "--type",
    apkmirrorType,
    "--out-file",
    `${app.id}-${requestedLabel}.${apkmirrorExtension}`,
    ...(app.apkmirrorFallbackArch ? ["--fallback-arch", app.apkmirrorFallbackArch] : []),
  ]);

  if (selectedVersion && metadata.version !== selectedVersion) {
    throw new Error(`${app.label}: APKMirror downloaded ${metadata.version}, expected ${selectedVersion}.`);
  }

  const downloaded = resolveMaybeRoot(metadata.path);
  if (!existsSync(downloaded)) {
    throw new Error(`${app.label}: APKMirror reported a missing downloaded file: ${metadata.path}`);
  }

  const extension = extname(downloaded).toLowerCase() || ".apk";
  const destination = replaceExtension(app.input, extension);
  rmSync(destination, { force: true });
  renameSync(downloaded, destination);
  app.input = destination;

  const list = patchesList || await fetchPatchesList();
  const topRecommendedVersion = recommendedVersionFor(app, list);
  const compatible = compatibleVersionsFor(app, list);

  await writeJson(metadataFile, {
    app: app.id,
    packageName: app.packageName,
    sourcePage: metadata.sourcePage,
    source: "apkmirror",
    directUrl: metadata.downloadUrl,
    downloadPage: metadata.downloadPage,
    variantPage: metadata.variantPage,
    destination,
    version: metadata.version,
    versionCode: metadata.versionCode,
    fileType: metadata.fileType,
    arch: metadata.arch,
    dpi: metadata.dpi,
    minAndroidVersion: metadata.minAndroidVersion,
    desiredVersion,
    fallbackFromVersion,
    fallbackReason,
    forcePatchRequired,
    morpheTopRecommendedVersion: topRecommendedVersion,
    availableCompatibleVersions: compatible.filter((version) => version === metadata.version),
    filename: basename(destination),
    size: metadata.size,
    downloadedAt: new Date().toISOString(),
  });
}

async function downloadWithPythonApkpure(
  app,
  {
    selectedVersion = "",
    force = false,
    patchesList = null,
    metadataFile,
    existing,
    desiredVersion = "",
    fallbackFromVersion = "",
    fallbackReason = "",
    forcePatchRequired = false,
    expectedVersion = "",
  },
) {
  if (
    selectedVersion &&
    !force &&
    existing?.source === "apkpure-python" &&
    existing?.version === selectedVersion &&
    existing?.destination &&
    existsSync(existing.destination)
  ) {
    app.input = existing.destination;
    console.log(`${app.label} ${selectedVersion} already downloaded at ${relative(app.input)}`);
    return;
  }

  const outputDir = fromRoot(".cache/apkpure-python", app.id);
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const requestedLabel = selectedVersion || "latest";
  console.log(`Downloading APKPure ${app.label} ${requestedLabel} with Python apkpure`);
  const metadata = runPythonJson([
    fromRoot("scripts/apkpure_download.py"),
    "--app-name",
    app.apkpureName,
    "--package-name",
    app.packageName,
    "--source-page",
    app.apkpurePage,
    "--out-dir",
    outputDir,
    ...(selectedVersion ? ["--version", selectedVersion] : []),
  ]);

  if (selectedVersion && metadata.version !== selectedVersion) {
    throw new Error(`${app.label}: Python apkpure downloaded ${metadata.version}, expected ${selectedVersion}.`);
  }

  if (expectedVersion && metadata.version !== expectedVersion) {
    console.warn(`${app.label}: APKPure latest metadata reported ${expectedVersion}, Python apkpure downloaded ${metadata.version}.`);
  }

  const downloaded = resolveMaybeRoot(metadata.path);
  if (!existsSync(downloaded)) {
    throw new Error(`${app.label}: Python apkpure reported a missing downloaded file: ${metadata.path}`);
  }

  const extension = extname(downloaded).toLowerCase() || ".apk";
  const destination = replaceExtension(app.input, extension);
  rmSync(destination, { force: true });
  renameSync(downloaded, destination);
  app.input = destination;

  const list = patchesList || await fetchPatchesList();
  const topRecommendedVersion = recommendedVersionFor(app, list);
  const compatible = compatibleVersionsFor(app, list);
  const availableVersions = Array.isArray(metadata.availableVersions) ? metadata.availableVersions : [];

  await writeJson(metadataFile, {
    app: app.id,
    packageName: app.packageName,
    sourcePage: app.apkpurePage,
    source: "apkpure-python",
    directUrl: metadata.downloadUrl,
    downloadPage: metadata.downloadPage,
    destination,
    version: metadata.version,
    versionCode: metadata.versionCode,
    fileType: metadata.fileType,
    desiredVersion,
    fallbackFromVersion,
    fallbackReason,
    forcePatchRequired,
    morpheTopRecommendedVersion: topRecommendedVersion,
    availableCompatibleVersions: compatible.filter((version) => availableVersions.includes(version)),
    filename: basename(destination),
    downloadedAt: new Date().toISOString(),
  });
}

async function downloadWithApkeep(app, { desiredVersion, force, patchesList, metadataFile, existing }) {
  const list = patchesList || await fetchPatchesList();
  const topRecommendedVersion = recommendedVersionFor(app, list);
  const compatible = compatibleVersionsFor(app, list);
  const available = await listApkeepVersions(app);
  const availableCompatible = compatible.filter((version) => available.includes(version));
  const selectedVersion = desiredVersion;
  const exactPageUrl = apkpureVersionPageUrl(app, selectedVersion);

  if (
    !force &&
    existing?.source === "apkeep" &&
    existing?.version === selectedVersion &&
    existing?.destination &&
    existsSync(existing.destination)
  ) {
    app.input = existing.destination;
    console.log(`${app.label} ${selectedVersion} already downloaded at ${relative(app.input)}`);
    return;
  }

  const outputDir = fromRoot(".cache/apkeep", app.id);
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const before = listFiles(outputDir);
  const appId = `${app.packageName}@${selectedVersion}`;
  const apkeep = await ensureApkeep(false);
  console.log(`Downloading ${app.label} ${selectedVersion} with apkeep (${exactPageUrl})`);
  run(apkeep, ["-a", appId, "-d", "apk-pure", outputDir]);

  const downloaded = [...listFiles(outputDir)].filter((file) => !before.has(file));
  const candidate = downloaded.find((file) => [".apk", ".apkm", ".xapk", ".apks"].includes(extname(file).toLowerCase()));

  if (!candidate) {
    throw new Error(
      `${app.label}: exact requested APK version ${selectedVersion} was not downloaded from APKPure. ` +
      `Checked exact APKPure page: ${exactPageUrl}. ` +
      `Morphe top recommended version: ${topRecommendedVersion || "unknown"}. ` +
      `Morphe compatible versions: ${compatible.join(", ") || "none"}. ` +
      `APKPure-compatible recommended versions found: ${availableCompatible.join(", ") || "none"}. ` +
      `Set ${envNameFor(app.id)}_URL to a direct APK URL for exactly ${selectedVersion}, or deliberately set APK_VERSION_SOURCE=latest.`,
    );
  }

  const extension = extname(candidate).toLowerCase() || ".apk";
  const destination = replaceExtension(app.input, extension);
  rmSync(destination, { force: true });
  renameSync(candidate, destination);
  app.input = destination;

  await writeJson(metadataFile, {
    app: app.id,
    packageName: app.packageName,
    sourcePage: app.apkpurePage,
    source: "apkeep",
    destination,
    version: selectedVersion,
    desiredVersion,
    exactPageUrl,
    morpheTopRecommendedVersion: topRecommendedVersion,
    availableCompatibleVersions: availableCompatible,
    filename: basename(destination),
    downloadedAt: new Date().toISOString(),
  });
}

async function inspectApkpureLatest(app) {
  return inspectApkpureDownload(app, apkpureDownloadUrl(app));
}

async function inspectApkpureDownload(app, url) {
  const response = await fetchWithRetry(url, {
    method: "HEAD",
    redirect: "follow",
    headers: apkpureHeaders(),
  });

  if (!response.ok) {
    throw new Error(`APKPure latest check failed for ${app.label} (${response.status})`);
  }

  const contentDisposition = response.headers.get("content-disposition") || "";
  const filename = parseHeaderFilename(contentDisposition);

  return {
    version: parseApkpureVersion(filename),
    filename,
    size: formatBytes(Number(response.headers.get("content-length") || 0)),
  };
}

function appendSigningArgs(args) {
  const keystoreFile = env("KEYSTORE_FILE");
  if (keystoreFile) args.push("--keystore", resolveMaybeRoot(keystoreFile));

  const keystorePassword = env("KEYSTORE_PASSWORD");
  if (keystorePassword) args.push("--keystore-password", keystorePassword);

  const alias = env("KEYSTORE_ALIAS");
  if (alias) args.push("--keystore-entry-alias", alias);

  const entryPassword = env("KEYSTORE_ENTRY_PASSWORD");
  if (entryPassword) args.push("--keystore-entry-password", entryPassword);

  const signer = env("SIGNER_NAME");
  if (signer) args.push("--signer", signer);

  if (truthy(env("UNSIGNED"))) args.push("--unsigned");
}

function checkJava() {
  const result = spawnSync("java", ["-version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error("Java is required. Install Java 17+ or run this through GitHub Actions.");
  }
}

function run(commandName, args) {
  const result = spawnSync(commandName, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${commandName} exited with status ${result.status}`);
  }
}

function runCapture(commandName, args) {
  const result = spawnSync(commandName, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${commandName} exited with status ${result.status}: ${result.stderr || result.stdout}`);
  }

  return `${result.stdout || ""}${result.stderr || ""}`;
}

function runPythonJson(args) {
  const commandName = pythonCommand();
  const result = spawnSync(commandName, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${commandName} exited with status ${result.status}: ${result.stderr || result.stdout}`);
  }

  const stdout = (result.stdout || "").trim();
  if (!stdout) throw new Error(`${commandName} produced no JSON output`);

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${commandName} produced invalid JSON: ${stdout}`);
  }
}

function pythonCommand() {
  return env("PYTHON_BIN") || "python";
}

async function githubJson(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "morph-youtube-builder",
      ...(env("GITHUB_TOKEN") ? { Authorization: `Bearer ${env("GITHUB_TOKEN")}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function downloadFile(url, destination, headers = {}) {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "morph-youtube-builder",
      ...headers,
      ...(env("GITHUB_TOKEN") && url.includes("github.com")
        ? { Authorization: `Bearer ${env("GITHUB_TOKEN")}` }
        : {}),
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status})`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }

    await sleep(750 * attempt);
  }

  throw lastError || new Error(`fetch failed for ${url}`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function writeJson(file, data) {
  const { writeFile } = await import("node:fs/promises");
  mkdirSync(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function readJson(file) {
  if (!existsSync(file)) return null;
  const { readFile } = await import("node:fs/promises");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function metadataFileFor(app) {
  return fromRoot(".cache/apks", `${app.id}.json`);
}

async function readApkMetadata(app) {
  return await readJson(metadataFileFor(app)) || await readJson(fromRoot(".cache/apkpure", `${app.id}.json`));
}

function clean() {
  rmSync(fromRoot(".cache"), { recursive: true, force: true });
  console.log("Removed .cache");
}

function printHelp() {
  console.log(`Usage:
  node scripts/morphe.mjs build [--target youtube] [--target de-revanced-all] [-- <morphe-cli patch args>]
  node scripts/morphe.mjs download [--target youtube] [--target de-revanced-all] [--force-download]
  node scripts/morphe.mjs options [--target youtube] [--target reddit]
  node scripts/morphe.mjs tools [--refresh-tools]
  node scripts/morphe.mjs versions
  node scripts/morphe.mjs release-notes
  node scripts/morphe.mjs root-modules
  node scripts/morphe.mjs clean

Environment:
  BUILD_TARGETS              Comma-separated targets. Defaults to youtube,youtube-music,reddit.
                             Use de-revanced-all to build every De-ReVanced supported app.
  MORPHE_CLI_VERSION         Release tag such as v1.7.0, or latest.
  MORPHE_PATCHES_VERSION     stable, dev, latest, or a release tag such as v1.24.0.
  MORPHE_PATCHES_REPO        Patch bundle repo. Defaults to MorpheApp/morphe-patches.
                             Use RookieEnough/De-ReVanced for De-ReVanced.
  YOUTUBE_APK                Local input path for YouTube.
  YOUTUBE_MUSIC_APK          Local input path for YouTube Music.
  REDDIT_APK                 Local input path for Reddit.
  YOUTUBE_APK_URL            Private direct URL for CI input.
  YOUTUBE_MUSIC_APK_URL      Private direct URL for CI input.
  REDDIT_APK_URL             Private direct URL for CI input.
  APK_SOURCE                 Comma-separated source order: apkmirror, apkpure, local, or auto.
                              Defaults to apkpure.
  APK_VERSION_SOURCE         recommended, latest, or an explicit version. Defaults to recommended.
  APK_FALLBACK_TO_LATEST     Set to 1 to fall back to latest if the recommended APK is unavailable.
  MORPHE_INCLUDE_EXPERIMENTAL_TARGETS
                             Set to 1 to allow experimental Morphe patch target versions.
  YOUTUBE_APK_VERSION        Explicit YouTube APK versionName override.
  YOUTUBE_MUSIC_APK_VERSION  Explicit YouTube Music APK versionName override.
  REDDIT_APK_VERSION         Explicit Reddit APK versionName override.
  APKMIRROR_ARCH             Optional APKMirror architecture override.
  APKMIRROR_DPI              Optional APKMirror DPI override. Defaults to nodpi.
  YOUTUBE_APKMIRROR_ARCH     YouTube APKMirror architecture. Defaults to universal.
  YOUTUBE_MUSIC_APKMIRROR_ARCH
                              YouTube Music APKMirror architecture. Defaults to arm64-v8a.
  REDDIT_APKMIRROR_TYPE      Reddit APKMirror file type. Defaults to bundle.
  REDDIT_APKMIRROR_ARCH      Reddit APKMirror architecture. Defaults to universal.
  REDDIT_APKMIRROR_DPI       Reddit APKMirror DPI. Defaults to 120-640dpi.
  YOUTUBE_PATCHED_PACKAGE_NAME
                              Defaults to com.mistu.android.youtube.
  YOUTUBE_MUSIC_PATCHED_PACKAGE_NAME
                              Defaults to com.mistu.android.youtube.music.
  REDDIT_PATCHED_PACKAGE_NAME
                              Optional; only works if the selected patch bundle supports it.
  ROOT_BUILD                  Set to 1 for root module builds that keep original package names.
  ROOT_ALLOW_OPTIONS_FILE     Set to 1 to pass root build options files. Defaults to off.
  ROOT_MODULE_VERSION         Optional module version label. Defaults to current UTC date.
  ROOT_MODULE_VERSION_CODE    Optional numeric module versionCode.
  AUTO_UPDATE_APKS           Set to 1 to refresh existing APK downloads during build.
  MORPHE_CONTINUE_ON_ERROR   Set to 1 to keep building later targets after a target fails.
  PYTHON_BIN                 Python executable for the APKPure downloader. Defaults to python.
  KEYSTORE_FILE              Optional signing keystore path.
  MORPHE_EXTRA_ARGS_JSON     Optional JSON array of extra patch args.`);
}

async function listApkeepVersions(app) {
  const apkeep = await ensureApkeep(false);
  const outputDir = fromRoot(".cache/apkeep-list");
  mkdirSync(outputDir, { recursive: true });

  const output = runCapture(apkeep, ["-l", "-a", app.packageName, "-d", "apk-pure", outputDir]);
  const versions = [...output.matchAll(/\b\d+(?:\.\d+)+\b/g)].map((match) => match[0]);
  return [...new Set(versions)].sort(compareVersions);
}

function optionValues(name) {
  const values = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    if (commandArgs[index] === `--${name}` && commandArgs[index + 1]) {
      values.push(commandArgs[index + 1]);
      index += 1;
    }
  }
  return values.flatMap(splitTargets);
}

function optionValue(name) {
  return optionValues(name)[0] ?? "";
}

function flag(name) {
  return commandArgs.includes(`--${name}`);
}

function splitTargets(value) {
  return value
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
}

function parseJsonArrayEnv(name) {
  const value = env(name);
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to the explicit error below.
  }

  throw new Error(`${name} must be a JSON string array, for example ["--disable","Custom branding"]`);
}

function normalizeTag(version) {
  return version.startsWith("v") ? version : `v${version}`;
}

function env(name) {
  return process.env[name]?.trim();
}

function envPath(name, fallback) {
  return resolveMaybeRoot(env(name) || fallback);
}

function resolveMaybeRoot(value) {
  return /^[a-zA-Z]:[\\/]|^\//.test(value) ? value : fromRoot(value);
}

function fromRoot(...segments) {
  return resolve(root, ...segments);
}

function relative(file) {
  return file.replace(`${root}\\`, "").replace(`${root}/`, "");
}

function envPrefixFor(id) {
  return id.replaceAll("-", "_").toUpperCase();
}

function envNameFor(id) {
  const names = {
    youtube: "YOUTUBE_APK",
    "youtube-music": "YOUTUBE_MUSIC_APK",
    reddit: "REDDIT_APK",
  };
  return names[id] || `${envPrefixFor(id)}_APK`;
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes((value || "").toLowerCase());
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
  if (patch?.name) return patch.name;
  if (Number.isInteger(patch?.index)) return `#${patch.index}`;
  return "";
}

function stepFailuresFrom(steps) {
  return Array.isArray(steps)
    ? steps
        .filter((step) => step?.success === false)
        .map((step) => `${step.step}${step.message ? `: ${firstReasonLine(step.message)}` : ""}`)
    : [];
}

function formatFailedPatch(entry) {
  return entry.reason ? `${entry.name} (${entry.reason})` : entry.name;
}

function formatPatchList(names, limit = 8) {
  if (!names.length) return "none";

  const shown = names.slice(0, limit);
  const remaining = names.length - shown.length;
  return remaining > 0
    ? `${shown.join(", ")}, +${remaining} more`
    : shown.join(", ");
}

function firstReasonLine(reason) {
  return String(reason || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function compareVersions(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function apkpureDownloadUrl(app, version = "latest") {
  return `https://d.apkpure.net/b/APK/${encodeURIComponent(app.packageName)}?version=${encodeURIComponent(version)}`;
}

function apkpureVersionPageUrl(app, version) {
  return `${app.apkpurePage.replace(/\/$/, "")}/download/${encodeURIComponent(version)}`;
}

function apkeepAssetName() {
  if (process.platform === "win32" && process.arch === "x64") return "apkeep-x86_64-pc-windows-msvc.exe";
  if (process.platform === "linux" && process.arch === "x64") return "apkeep-x86_64-unknown-linux-gnu";
  if (process.platform === "linux" && process.arch === "arm64") return "apkeep-aarch64-unknown-linux-gnu";

  throw new Error(`Unsupported platform for automatic apkeep download: ${process.platform}/${process.arch}`);
}

function listFiles(dir) {
  const files = new Set();
  const visit = (current) => {
    for (const entry of readdirSync(current)) {
      const file = join(current, entry);
      if (statSync(file).isDirectory()) {
        visit(file);
      } else {
        files.add(file);
      }
    }
  };
  visit(dir);
  return files;
}

function replaceExtension(file, extension) {
  return file.slice(0, file.length - extname(file).length) + extension;
}

function apkpureHeaders() {
  return {
    "Accept": "application/vnd.android.package-archive,*/*",
    "Referer": "https://apkpure.net/",
    "User-Agent": "Mozilla/5.0 morph-youtube-builder",
  };
}

function parseHeaderFilename(contentDisposition) {
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ""));

  const asciiMatch = contentDisposition.match(/filename="([^"]+)"/i) || contentDisposition.match(/filename=([^;]+)/i);
  return asciiMatch ? asciiMatch[1].trim().replace(/^"|"$/g, "") : "";
}

function parseApkpureVersion(filename) {
  const match = filename.match(/_(\d+(?:\.\d+)+)_APKPure\.(?:apk|xapk|apks)$/i);
  return match?.[1] || "";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function usableFile(file) {
  try {
    return existsSync(file) && statSync(file).size > 0;
  } catch {
    return false;
  }
}
