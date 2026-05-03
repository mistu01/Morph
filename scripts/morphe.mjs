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
const packageNamePattern = /^[a-z]\w*(\.[a-z]\w*)+$/;
const rootBuild = truthy(env("ROOT_BUILD"));

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
    repo: "MorpheApp/morphe-patches",
    versionEnv: "MORPHE_PATCHES_VERSION",
    assetPattern: /^patches-.+\.mpp$/,
    output: fromRoot(".cache/tools/patches.mpp"),
    meta: fromRoot(".cache/tools/patches.json"),
  },
};

const apkeepTool = {
  repo: "EFForg/apkeep",
  versionEnv: "APKEEP_VERSION",
  output: fromRoot(".cache/tools", process.platform === "win32" ? "apkeep.exe" : "apkeep"),
  meta: fromRoot(".cache/tools/apkeep.json"),
};

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
  mkdirSync(paths.output, { recursive: true });
  mkdirSync(paths.tmp, { recursive: true });

  for (const app of selectedApps()) {
    await ensureInput(app);
    await ensurePackageNameOptions(app);
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

    if (existsSync(app.options)) {
      args.push("--options-file", app.options);
      if (truthy(env("MORPHE_OPTIONS_UPDATE"))) args.push("--options-update");
    }

    args.push(...patchArgs, app.input);

    console.log(`\n==> Building ${app.label}`);
    run("java", args);
  }
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
    antiAutoUpdate: {
      unregisterPlayStoreInstaller: true,
      removeUserUpdateOverlayKeepingData: true,
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
    await ensurePackageNameOptions(app);
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
  const releaseUrl = version === "latest"
    ? `https://api.github.com/repos/${config.repo}/releases/latest`
    : `https://api.github.com/repos/${config.repo}/releases/tags/${normalizeTag(version)}`;
  const release = await githubJson(releaseUrl);
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

async function fetchPatchesList() {
  patchesListPromise ||= (async () => {
    const tag = await selectedPatchReleaseTag();
    return githubJson(`https://raw.githubusercontent.com/MorpheApp/morphe-patches/${tag}/patches-list.json`);
  })();
  return patchesListPromise;
}

async function selectedPatchReleaseTag() {
  const version = env("MORPHE_PATCHES_VERSION") || "latest";
  if (version !== "latest") return normalizeTag(version);

  selectedPatchReleaseTagPromise ||= (async () => {
    const release = await githubJson("https://api.github.com/repos/MorpheApp/morphe-patches/releases/latest");
    return release.tag_name;
  })();
  return selectedPatchReleaseTagPromise;
}

async function printVersions() {
  const [cliRelease, patchesRelease, patchesList] = await Promise.all([
    githubJson("https://api.github.com/repos/MorpheApp/morphe-cli/releases/latest"),
    githubJson("https://api.github.com/repos/MorpheApp/morphe-patches/releases/latest"),
    fetchPatchesList(),
  ]);

  console.log(`Morphe CLI latest: ${cliRelease.tag_name}`);
  console.log(`Morphe patches latest: ${patchesRelease.tag_name}`);
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
    if (!patch.compatiblePackages) continue;
    for (const [packageName, versions] of Object.entries(patch.compatiblePackages)) {
      if (!packages.has(packageName)) packages.set(packageName, new Set());
      for (const version of versions ?? []) packages.get(packageName).add(version);
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
    const compatible = compatibleVersionsFor(app, list);
    return compatible[0] || "";
  }
  if (/^\d+(?:\.\d+)+$/.test(source)) return source;

  throw new Error(`Unsupported APK_VERSION_SOURCE "${source}". Use recommended, latest, or an explicit version like 20.47.62.`);
}

function recommendedVersionFor(app, patchesList) {
  return compatibleVersionsFor(app, patchesList)[0] || "";
}

function compatibleVersionsFor(app, patchesList) {
  const versions = new Set();

  for (const patch of patchesList?.patches || []) {
    const compatible = patch?.compatiblePackages?.[app.packageName];
    if (!Array.isArray(compatible)) continue;
    for (const version of compatible) versions.add(String(version));
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
  lines.push(`- Morphe patches: ${patchesMeta?.tag || env("MORPHE_PATCHES_VERSION") || "latest"}`);
  lines.push(`- APK version source: ${env("APK_VERSION_SOURCE") || "recommended"}`);
  lines.push(`- Build variant: ${rootBuild ? "root module" : "standard APK"}`);
  lines.push(`- Patch args: ${patchArgs.length ? patchArgs.join(" ") : "none"}`);
  if (rootBuild) {
    lines.push("- Root modules: Magisk, KernelSU, and APatch compatible module ZIPs are attached.");
  }
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

    lines.push(`## ${app.label}`);
    lines.push("");
    lines.push(`- APK version: ${apkVersion}`);
    lines.push(`- Package: ${packageName}`);
    if (sourcePackageName !== packageName) lines.push(`- Source package: ${sourcePackageName}`);
    if (rootBuild) lines.push(`- Module install path: /${app.rootApkPath}`);
    if (apkMeta?.filename) lines.push(`- Source APK: ${apkMeta.filename}${apkMeta.size ? ` (${apkMeta.size})` : ""}`);
    if (apkMeta?.source) lines.push(`- APK source: ${apkMeta.source}`);
    if (apkMeta?.desiredVersion) lines.push(`- Requested APK version: ${apkMeta.desiredVersion}`);
    if (apkMeta?.fallbackFromVersion) lines.push(`- Fallback: exact ${apkMeta.fallbackFromVersion} was unavailable; used ${apkSourceLabel(apkMeta.source)} latest with --force`);
    if (apkMeta?.morpheTopRecommendedVersion) lines.push(`- Morphe top recommended APK version: ${apkMeta.morpheTopRecommendedVersion}`);
    if (Array.isArray(apkMeta?.availableCompatibleVersions)) {
      lines.push(`- Source-compatible recommended versions found: ${apkMeta.availableCompatibleVersions.join(", ") || "none"}`);
    }
    if (apkMeta?.forcePatchRequired) lines.push("- Patch args added for this target: --force");
    lines.push(`- Build result: ${buildResult}`);
    lines.push(`- Successful patches (${applied.length}): ${applied.length ? applied.join(", ") : "none"}`);
    lines.push(`- Failed patches (${failed.length}): ${failed.length ? failed.map(formatFailedPatch).join("; ") : "none"}`);
    if (stepFailures.length) {
      lines.push(`- Failed build steps: ${stepFailures.join("; ")}`);
    }
    lines.push("");
  }

  lines.push("Review the attached `*-result.json` files for full patching details.");
  lines.push("");
  lines.push("Warning: `--continue-on-error` can produce a partially patched APK if any patch fails.");

  console.log(lines.join("\n"));
}

function selectedApps() {
  const explicitTargets = optionValues("target").concat(optionValues("targets"));
  const targets = (explicitTargets.length
    ? explicitTargets
    : splitTargets(env("BUILD_TARGETS") || "youtube,youtube-music,reddit"))
    .filter(Boolean);

  const uniqueTargets = [...new Set(targets)];
  const unknown = uniqueTargets.filter((target) => !appConfigs[target]);
  if (unknown.length) {
    throw new Error(`Unknown target(s): ${unknown.join(", ")}. Valid targets: ${Object.keys(appConfigs).join(", ")}`);
  }

  return uniqueTargets.map((target) => appConfigs[target]);
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
  return args;
}

async function ensurePackageNameOptions(app) {
  if (rootBuild) {
    console.log(`${app.label}: root build keeps the original package name ${app.packageName}`);
    return;
  }
  if (!app.patchedPackageName) return;
  if (!packageNamePattern.test(app.patchedPackageName)) {
    throw new Error(`${app.label}: invalid patched package name "${app.patchedPackageName}".`);
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

function patchCompatibleWithApp(patch, app) {
  if (!patch.compatiblePackages) return true;
  return Object.prototype.hasOwnProperty.call(patch.compatiblePackages, app.packageName);
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
    stagedApkName: `${app.id}.apk`,
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

  writeFileSync(join(moduleDir, "customize.sh"), rootCustomizeScript(entries));

  writeFileSync(join(moduleDir, "post-fs-data.sh"), rootLifecycleScript(packageNames, "post-fs-data"));
  writeFileSync(join(moduleDir, "post-mount.sh"), rootLifecycleScript(packageNames, "post-mount"));
  writeFileSync(join(moduleDir, "service.sh"), rootLifecycleScript(packageNames, "service"));
  writeFileSync(join(moduleDir, "uninstall.sh"), rootUninstallScript(packageNames));
  writeFileSync(join(moduleDir, "system.prop"), [
    "# Module intentionally keeps system properties unchanged.",
    "",
  ].join("\n"));

  writeFileSync(join(moduleDir, "README.md"), [
    `# ${name}`,
    "",
    "Install this ZIP with Magisk, KernelSU, KernelSU Next, or APatch, then reboot.",
    "During installation, the module detects each app's current system path and places the patched APK into the matching systemless system partition path.",
    "The module re-applies Play Store detach commands at boot and removes user-installed update overlays while keeping app data.",
    "This is designed to keep the mounted root APK active even if Play Store tries to update the package.",
    "",
    "Included apps:",
    ...entries.map((app) => `- ${app.label}: ${app.packageName} -> ${app.fallbackSystemPath} fallback`),
    "",
  ].join("\n"));

  for (const app of entries) {
    const destination = join(moduleDir, "common", "apks", app.stagedApkName);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(app.output, destination);
  }
}

function rootCustomizeScript(apps) {
  const appLines = apps.map((app) => [
    app.packageName,
    app.label,
    app.stagedApkName,
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
    "ui_print \"- Install mode: device-detected system app path\"",
    "ui_print \"- Play Store: detach and block user update overlays\"",
    "ui_print \"- Legacy replace file: not used\"",
    "ui_print \"\"",
    "",
    "APP_LIST=$(cat <<'EOF_APP_LIST'",
    ...appLines,
    "EOF_APP_LIST",
    ")",
    "",
    "module_system_path() {",
    "  local path=\"$1\"",
    "  case \"$path\" in",
    "    /system/*) printf '%s/system/%s\\n' \"$MODPATH\" \"${path#/system/}\" ;;",
    "    /product/*) printf '%s/system/product/%s\\n' \"$MODPATH\" \"${path#/product/}\" ;;",
    "    /system_ext/*) printf '%s/system/system_ext/%s\\n' \"$MODPATH\" \"${path#/system_ext/}\" ;;",
    "    /vendor/*) printf '%s/system/vendor/%s\\n' \"$MODPATH\" \"${path#/vendor/}\" ;;",
    "    *) return 1 ;;",
    "  esac",
    "}",
    "",
    "detect_system_apk_path() {",
    "  local pkg=\"$1\"",
    "  local path",
    "  path=\"$(pm path \"$pkg\" 2>/dev/null | sed -n 's/^package://p' | grep -E '^/(system|product|system_ext|vendor)/.*\\.apk$' | head -n 1)\"",
    "  [ -n \"$path\" ] && printf '%s\\n' \"$path\"",
    "}",
    "",
    "install_root_apk() {",
    "  local pkg=\"$1\" label=\"$2\" apk_name=\"$3\" fallback_path=\"$4\"",
    "  local source_apk target_path target_apk target_dir",
    "  source_apk=\"$MODPATH/common/apks/$apk_name\"",
    "  [ -f \"$source_apk\" ] || abort \"Missing staged APK for $label: $source_apk\"",
    "",
    "  target_path=\"$(detect_system_apk_path \"$pkg\")\"",
    "  [ -n \"$target_path\" ] || target_path=\"$fallback_path\"",
    "  target_apk=\"$(module_system_path \"$target_path\")\" || abort \"Unsupported system path for $label: $target_path\"",
    "  target_dir=\"${target_apk%/*}\"",
    "",
    "  rm -rf \"$target_dir\"",
    "  mkdir -p \"$target_dir\"",
    "  cp -f \"$source_apk\" \"$target_apk\"",
    "  chmod 0755 \"$target_dir\"",
    "  chmod 0644 \"$target_apk\"",
    "  ui_print \"- App: $label\"",
    "  ui_print \"  Package: $pkg\"",
    "  ui_print \"  Source: $apk_name\"",
    "  ui_print \"  Target: $target_path\"",
    "}",
    "",
    "while IFS='|' read -r pkg label apk_name fallback_path; do",
    "  [ -n \"$pkg\" ] || continue",
    "  install_root_apk \"$pkg\" \"$label\" \"$apk_name\" \"$fallback_path\"",
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

function rootLifecycleScript(packageNames, stage) {
  const packageList = packageNames.join(" ");
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
    `PACKAGES="${packageList}"`,
    "PLAY_STORE=com.android.vending",
    "",
    "log() {",
    "  echo \"$(date '+%Y-%m-%d %H:%M:%S') [$1] $2\" >> \"$LOG\"",
    "}",
    "",
    ...waitForBoot,
    "",
    "detach_package() {",
    "  local pkg=\"$1\"",
    "  pm uninstall -k --user 0 \"$pkg\" >/dev/null 2>&1 || true",
    "  cmd package install-existing \"$pkg\" >/dev/null 2>&1 || true",
    "  cmd package set-installer \"$pkg\" com.android.shell >/dev/null 2>&1 || true",
    "  pm set-installer \"$pkg\" com.android.shell >/dev/null 2>&1 || true",
    "  cmd package compile -r bg-dexopt \"$pkg\" >/dev/null 2>&1 || true",
    "}",
    "",
    "detach_play_store_db() {",
    "  command -v sqlite3 >/dev/null 2>&1 || return 0",
    "  [ -d /data/data/$PLAY_STORE/databases ] || return 0",
    "",
    "  local pkg db",
    "  for pkg in $PACKAGES; do",
    "    for db in /data/data/$PLAY_STORE/databases/*.db; do",
    "      [ -f \"$db\" ] || continue",
    "      sqlite3 \"$db\" \"DELETE FROM ownership WHERE doc_id='$pkg' OR package_name='$pkg' OR packageName='$pkg';\" >/dev/null 2>&1 || true",
    "      sqlite3 \"$db\" \"DELETE FROM auto_update WHERE doc_id='$pkg' OR package_name='$pkg' OR packageName='$pkg';\" >/dev/null 2>&1 || true",
    "      sqlite3 \"$db\" \"DELETE FROM appstate WHERE package_name='$pkg' OR packageName='$pkg';\" >/dev/null 2>&1 || true",
    "      sqlite3 \"$db\" \"UPDATE localappstate SET auto_update=0 WHERE package_name='$pkg' OR packageName='$pkg';\" >/dev/null 2>&1 || true",
    "      sqlite3 \"$db\" \"UPDATE local_app_state SET auto_update=0 WHERE package_name='$pkg' OR packageName='$pkg';\" >/dev/null 2>&1 || true",
    "    done",
    "  done",
    "}",
    "",
    "for pkg in $PACKAGES; do",
    "  detach_package \"$pkg\"",
    "done",
    "detach_play_store_db",
    "log \"ok\" \"Applied root module package registration and Play Store detach for: $PACKAGES\"",
    "",
  ].join("\n");
}

function rootUninstallScript(packageNames) {
  return [
    "#!/system/bin/sh",
    `PACKAGES="${packageNames.join(" ")}"`,
    "for pkg in $PACKAGES; do",
    "  cmd package set-installer \"$pkg\" com.android.vending >/dev/null 2>&1 || true",
    "  pm set-installer \"$pkg\" com.android.vending >/dev/null 2>&1 || true",
    "done",
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

function createZip(sourceDir, destination) {
  rmSync(destination, { force: true });
  mkdirSync(dirname(destination), { recursive: true });
  run("jar", ["--create", "--file", destination, "-C", sourceDir, "."]);
}

function releaseVersionName() {
  return env("ROOT_MODULE_VERSION") || new Date().toISOString().slice(0, 10);
}

function releaseVersionCode() {
  const explicit = env("ROOT_MODULE_VERSION_CODE");
  if (explicit) return explicit;
  return new Date().toISOString().replace(/\D/g, "").slice(0, 12);
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
  return !app.requestedVersion && (env("APK_VERSION_SOURCE") || "recommended").toLowerCase() === "recommended";
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
  node scripts/morphe.mjs build [--target youtube] [--target youtube-music] [--target reddit] [-- <morphe-cli patch args>]
  node scripts/morphe.mjs download [--target youtube] [--target youtube-music] [--target reddit] [--force-download]
  node scripts/morphe.mjs options [--target youtube] [--target youtube-music] [--target reddit]
  node scripts/morphe.mjs tools [--refresh-tools]
  node scripts/morphe.mjs versions
  node scripts/morphe.mjs release-notes
  node scripts/morphe.mjs root-modules
  node scripts/morphe.mjs clean

Environment:
  BUILD_TARGETS              Comma-separated targets. Defaults to youtube,youtube-music,reddit.
  MORPHE_CLI_VERSION         Release tag such as v1.7.0, or latest.
  MORPHE_PATCHES_VERSION     Release tag such as v1.24.0, or latest.
  YOUTUBE_APK                Local input path for YouTube.
  YOUTUBE_MUSIC_APK          Local input path for YouTube Music.
  REDDIT_APK                 Local input path for Reddit.
  YOUTUBE_APK_URL            Private direct URL for CI input.
  YOUTUBE_MUSIC_APK_URL      Private direct URL for CI input.
  REDDIT_APK_URL             Private direct URL for CI input.
  APK_SOURCE                 Comma-separated source order: apkmirror, apkpure, local, or auto.
                              Defaults to apkpure.
  APK_VERSION_SOURCE         recommended, latest, or an explicit version. Defaults to recommended.
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
  ROOT_MODULE_VERSION         Optional module version label. Defaults to current UTC date.
  ROOT_MODULE_VERSION_CODE    Optional numeric module versionCode.
  AUTO_UPDATE_APKS           Set to 1 to refresh existing APK downloads during build.
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

function envNameFor(id) {
  const names = {
    youtube: "YOUTUBE_APK",
    "youtube-music": "YOUTUBE_MUSIC_APK",
    reddit: "REDDIT_APK",
  };
  return names[id] || `${id.replaceAll("-", "_").toUpperCase()}_APK`;
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
