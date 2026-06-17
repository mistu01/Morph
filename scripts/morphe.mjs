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
const rootStockInputExtensions = new Set([".apk", ".xapk", ".apkm", ".apks"]);
const packageNamePattern = /^[a-z]\w*(\.[a-z]\w*)+$/;
const rootBuild = truthy(env("ROOT_BUILD"));
const packageNameOptionsDisabled = truthy(env("MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS"));
const defaultTargets = ["youtube", "youtube-music", "reddit"];
const allYoutubeAbiVariants = [
  { artifactAbi: "arm64-v8a", apkmirrorArch: "arm64-v8a" },
  { artifactAbi: "arm-v7a", apkmirrorArch: "armeabi-v7a" },
];
const youtubeAbiVariants = selectedYoutubeAbiVariants();

const appConfigs = {
  ...youtubeAbiAppConfigs({
    id: "youtube",
    label: "YouTube",
    apkpureName: "YouTube",
    packageName: "com.google.android.youtube",
    apkpureSlug: "youtube-2025",
    apkpurePage: "https://apkpure.com/youtube-2025/com.google.android.youtube",
    uptodownSlug: "youtube",
    divxlandSlug: "youtube",
    apkmirrorOrg: "google-inc",
    apkmirrorRepo: "youtube",
    rootModuleId: "mistu_youtube_root",
    rootModuleName: "Mistu YouTube Root",
    rootApkPath: "system/product/app/YouTube/YouTube.apk",
  }),
  ...youtubeAbiAppConfigs({
    id: "youtube-music",
    label: "YouTube Music",
    apkpureName: "YouTube Music",
    packageName: "com.google.android.apps.youtube.music",
    apkpureSlug: "youtube-music",
    apkpurePage: "https://apkpure.com/youtube-music/com.google.android.apps.youtube.music",
    uptodownSlug: "youtube-music",
    divxlandSlug: "youtube-music",
    apkmirrorOrg: "google-inc",
    apkmirrorRepo: "youtube-music",
    rootModuleId: "mistu_youtube_music_root",
    rootModuleName: "Mistu YouTube Music Root",
    rootApkPath: "system/product/app/YouTubeMusic/YouTubeMusic.apk",
  }),
  reddit: {
    id: "reddit",
    label: "Reddit",
    apkpureName: "Reddit",
    packageName: "com.reddit.frontpage",
    apkpureSlug: "reddit-app",
    apkpurePage: "https://apkpure.com/reddit-app/com.reddit.frontpage",
    uptodownSlug: "reddit-official-app",
    divxlandSlug: "reddit",
    apkmirrorOrg: "redditinc",
    apkmirrorRepo: "reddit",
    apkmirrorType: env("REDDIT_APKMIRROR_TYPE") || "bundle",
    apkmirrorArch: env("REDDIT_APKMIRROR_ARCH") || env("APKMIRROR_ARCH") || "arm64-v8a",
    apkmirrorFallbackArch: env("REDDIT_APKMIRROR_FALLBACK_ARCH") || env("APKMIRROR_FALLBACK_ARCH") || "universal",
    apkmirrorDpi: env("REDDIT_APKMIRROR_DPI") || env("APKMIRROR_DPI") || "120-640dpi",
    patchedPackageName: packageNameOptionsDisabled ? "" : env("REDDIT_PATCHED_PACKAGE_NAME"),
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
  ...externalPatchAppConfigs([
    ["adguard", "AdGuard", "com.adguard.android"],
    ["alltrails", "AllTrails", "com.alltrails.alltrails"],
    ["avocards", "Avocards", "com.avocards"],
    ["busuu", "Busuu", "com.busuu.android.enc"],
    ["cake", "Cake", "me.mycake"],
    ["camscanner", "CamScanner", "com.intsig.camscanner"],
    ["daily-pocket", "Daily Pocket", "kr.co.yjteam.dailypay"],
    ["duolingo", "Duolingo", "com.duolingo"],
    ["eggbun", "Eggbun", "kr.eggbun.eggconvo"],
    ["fotmob", "FotMob", "com.mobilefootie.wc2010"],
    ["github", "GitHub", "com.github.android"],
    ["hellochinese", "HelloChinese", "com.hellochinese"],
    ["ibispaint-x", "IbisPaint X", "jp.ne.ibis.ibispaintx.app"],
    ["icon-packer", "Icon Packer", "cn.ommiao.iconpacker"],
    ["lingory", "Lingory", "org.languageapp.lingory"],
    ["lyfta", "Lyfta", "com.lyfta"],
    ["macrofactor", "MacroFactor", "com.sbs.diet"],
    ["macrofactor-workouts", "MacroFactor Workouts", "com.sbs.train"],
    ["meme-generator", "Meme Generator", "com.zombodroid.MemeGenerator"],
    ["merriam-webster", "Merriam-Webster", "com.merriamwebster"],
    ["mimo", "Mimo", "com.getmimo"],
    ["mirinae", "Mirinae", "com.mirinae.mirinae"],
    ["myexpenses", "MyExpenses", "org.totschnig.myexpenses"],
    ["myfitnesspal", "MyFitnessPal", "com.myfitnesspal.android"],
    ["niagara-launcher", "Niagara Launcher", "bitpit.launcher"],
    ["nomone-desktop", "NOMone Desktop", "nom.vrd"],
    ["nova-launcher", "Nova Launcher", "com.teslacoilsw.launcher"],
    ["pandora", "Pandora", "com.pandora.android"],
    ["podcast-addict", "Podcast Addict", "com.bambuna.podcastaddict"],
    ["prime-video", "Prime Video", "com.amazon.avod.thirdpartyclient"],
    ["proton-vpn", "Proton VPN", "ch.protonvpn.android", {
      apkmirrorOrg: "proton-technologies-ag",
      apkmirrorRepo: "protonvpn-secure-and-free-vpn",
      apkmirrorSlug: "proton-vpn-fast-secure-vpn",
      apkmirrorType: "bundle",
      apkmirrorFallbackArch: "universal",
      apkmirrorDpi: "120-640dpi",
    }],
    ["pydroid3", "PyDroid3", "ru.iiec.pydroid3"],
    ["rp-hypertrophy", "RP Hypertrophy", "com.rp.hypertrophy"],
    ["showly", "Showly", "com.michaldrabik.showly2"],
    ["sleep-as-android", "Sleep as Android", "com.urbandroid.sleep"],
    ["smart-launcher", "Smart Launcher", "ginlemon.flowerfree"],
    ["snorelab", "SnoreLab", "com.snorelab.app"],
    ["sofascore", "Sofascore", "com.sofascore.results"],
    ["solid-explorer", "Solid Explorer", "pl.solidexplorer2"],
    ["soundcloud", "SoundCloud", "com.soundcloud.android"],
    ["teuida", "Teuida", "net.teuida.teuida"],
    ["ttmik-stories", "TTMIK Stories", "app.ttmikstories.android"],
    ["ventusky", "Ventusky", "cz.ackee.ventusky"],
    ["wallcraft", "Wallcraft", "com.wallpaperscraft.wallpaper"],
    ["windy", "Windy", "com.windyty.android"],
    ["world-map-quiz", "World Map Quiz", "com.qbis.guessthecountry"],
    ["wps-office", "WPS Office", "cn.wps.moffice_eng"],
    ["xodo", "Xodo", "com.xodo.pdf.reader"],
    ["xrecorder", "XRecorder", "videoeditor.videorecorder.screenrecorder"],
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
    ["sd-maid-se", "SD Maid SE", "eu.darken.sdmse"],
    ["starsense-explorer", "StarSense Explorer", "com.celestron.skybox"],
    ["telegram", "Telegram", "org.telegram.messenger.web"],
    ["ticktick", "TickTick", "com.ticktick.task"],
    ["trackit", "TrackIt", "app.vinztech.trackit"],
    ["truecaller", "Truecaller", "com.truecaller"],
    ["vn", "VN", "com.frontrow.vlog"],
  ]),
};

const targetAliases = {
  youtube: youtubeAbiVariants.map((variant) => youtubeAbiTargetId("youtube", variant)),
  "youtube-music": youtubeAbiVariants.map((variant) => youtubeAbiTargetId("youtube-music", variant)),
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
    provider: env("MORPHE_PATCHES_PROVIDER") || "github",
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

function youtubeAbiAppConfigs(config) {
  return Object.fromEntries(youtubeAbiVariants.map((variant) => {
    const id = youtubeAbiTargetId(config.id, variant);
    const envPrefix = envPrefixFor(config.id);
    const variantEnvPrefix = envPrefixFor(id);
    const rootOutput = `output/root/${id}-root.apk`;
    const standardOutput = `output/${id}-patched.apk`;
    const rootResult = `output/root/${id}-result.json`;
    const standardResult = `output/${id}-result.json`;

    return [id, {
      ...config,
      id,
      label: `${config.label} (${variant.artifactAbi})`,
      baseId: config.id,
      baseLabel: config.label,
      artifactAbi: variant.artifactAbi,
      uptodownSlug: env(`${variantEnvPrefix}_UPTODOWN_SLUG`) || env(`${envPrefix}_UPTODOWN_SLUG`) || config.uptodownSlug || config.id,
      divxlandSlug: env(`${variantEnvPrefix}_DIVXLAND_SLUG`) || env(`${envPrefix}_DIVXLAND_SLUG`) || config.divxlandSlug || config.id,
      apkmirrorArch: env(`${variantEnvPrefix}_APKMIRROR_ARCH`)
        || env(`${envPrefix}_APKMIRROR_ARCH`)
        || env("APKMIRROR_ARCH")
        || variant.apkmirrorArch,
      apkmirrorType: env(`${variantEnvPrefix}_APKMIRROR_TYPE`)
        || env(`${envPrefix}_APKMIRROR_TYPE`)
        || env("APKMIRROR_TYPE")
        || "bundle",
      apkmirrorFallbackArch: env(`${variantEnvPrefix}_APKMIRROR_FALLBACK_ARCH`)
        || env(`${envPrefix}_APKMIRROR_FALLBACK_ARCH`)
        || env("APKMIRROR_FALLBACK_ARCH")
        || "universal",
      apkmirrorDpi: env(`${variantEnvPrefix}_APKMIRROR_DPI`)
        || env(`${envPrefix}_APKMIRROR_DPI`)
        || env("APKMIRROR_DPI")
        || "any",
      patchedPackageName: packageNameOptionsDisabled ? "" : env(`${variantEnvPrefix}_PATCHED_PACKAGE_NAME`)
        || env(`${envPrefix}_PATCHED_PACKAGE_NAME`)
        || (config.id === "youtube" ? "com.mistu.android.youtube" : "com.mistu.android.youtube.music"),
      requestedVersion: env(`${variantEnvPrefix}_APK_VERSION`) || env(`${envPrefix}_APK_VERSION`),
      input: envPathValue(env(`${variantEnvPrefix}_APK`) || env(`${envPrefix}_APK`) || `input/${id}.apk`),
      url: env(`${variantEnvPrefix}_APK_URL`) || env(`${envPrefix}_APK_URL`),
      output: envPath(`${variantEnvPrefix}_OUT`, rootBuild ? rootOutput : standardOutput),
      options: envPathValue(
        env(`${variantEnvPrefix}_OPTIONS`)
        || env(`${envPrefix}_OPTIONS`)
        || (rootBuild ? `config/root/${config.id}-options.json` : `config/${config.id}-options.json`),
      ),
      result: envPath(`${variantEnvPrefix}_RESULT`, rootBuild ? rootResult : standardResult),
      rootModuleId: `${config.rootModuleId}_${variant.artifactAbi.replaceAll("-", "_")}`,
      rootModuleName: `${config.rootModuleName} (${variant.artifactAbi})`,
    }];
  }));
}

function externalPatchAppConfigs(entries) {
  return Object.fromEntries(entries.map(([id, label, packageName, overrides = {}]) => {
    const envPrefix = envPrefixFor(id);
    const apkpureSlug = overrides.apkpureSlug || id;

    return [id, {
      id,
      label,
      apkpureName: label,
      packageName,
      apkpureSlug,
      apkpurePage: overrides.apkpurePage || `https://apkpure.com/${apkpureSlug}/${packageName}`,
      uptodownSlug: overrides.uptodownSlug || id,
      divxlandSlug: overrides.divxlandSlug || id,
      apkmirrorOrg: overrides.apkmirrorOrg || "",
      apkmirrorRepo: overrides.apkmirrorRepo || "",
      apkmirrorSlug: overrides.apkmirrorSlug || "",
      apkmirrorType: env(`${envPrefix}_APKMIRROR_TYPE`) || env("APKMIRROR_TYPE") || overrides.apkmirrorType || "apk",
      apkmirrorArch: env(`${envPrefix}_APKMIRROR_ARCH`) || env("APKMIRROR_ARCH") || overrides.apkmirrorArch || "arm64-v8a",
      apkmirrorFallbackArch: env(`${envPrefix}_APKMIRROR_FALLBACK_ARCH`) || env("APKMIRROR_FALLBACK_ARCH") || overrides.apkmirrorFallbackArch || "",
      apkmirrorDpi: env(`${envPrefix}_APKMIRROR_DPI`) || env("APKMIRROR_DPI") || overrides.apkmirrorDpi || "nodpi",
      requestedVersion: env(`${envPrefix}_APK_VERSION`),
      input: envPath(`${envPrefix}_APK`, `input/${id}.apk`),
      url: env(`${envPrefix}_APK_URL`),
      output: envPath(`${envPrefix}_OUT`, `output/${id}-patched.apk`),
      options: envPath(`${envPrefix}_OPTIONS`, `config/${id}-options.json`),
      result: envPath(`${envPrefix}_RESULT`, `output/${id}-result.json`),
    }];
  }));
}

function youtubeAbiTargetId(baseId, variant) {
  return `${baseId}-${variant.artifactAbi}`;
}

function selectedYoutubeAbiVariants() {
  const raw = env("YOUTUBE_ABIS") || env("MORPHE_YOUTUBE_ABIS") || "arm64-v8a,arm-v7a";
  const requested = raw
    .split(/[,\s]+/)
    .map(normalizeYoutubeAbi)
    .filter(Boolean);
  const selected = requested.includes("all")
    ? allYoutubeAbiVariants.map((variant) => variant.artifactAbi)
    : requested.length ? [...new Set(requested)] : allYoutubeAbiVariants.map((variant) => variant.artifactAbi);
  const known = new Set(allYoutubeAbiVariants.map((variant) => variant.artifactAbi));
  const unknown = selected.filter((abi) => !known.has(abi));
  if (unknown.length) {
    throw new Error(`Unknown YouTube ABI selection: ${unknown.join(", ")}. Valid values: arm64-v8a, arm-v7a.`);
  }

  return allYoutubeAbiVariants.filter((variant) => selected.includes(variant.artifactAbi));
}

function normalizeYoutubeAbi(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (["all", "both", "arm64-v8a+arm-v7a", "arm64-v8a,arm-v7a"].includes(normalized)) return "all";
  if (["arm64", "arm64-v8a", "arm-v8a", "v8a", "v8a-only", "arm64-only"].includes(normalized)) return "arm64-v8a";
  if (["armeabi-v7a", "arm-v7a", "v7a", "arm32"].includes(normalized)) return "arm-v7a";
  return normalized;
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
    case "release-check":
      await checkReleaseOutputs();
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

async function checkReleaseOutputs() {
  const missing = [];
  const continueOnError = shouldContinueBuildOnError();
  const successfulLabels = [];
  const skippedLabels = [];
  let successCount = 0;

  for (const app of selectedApps()) {
    const outputStatus = await inspectReleaseOutput(app);
    if (!outputStatus.ok) {
      if (continueOnError) {
        console.warn(`warning: ${app.label}: ${outputStatus.reason} - skipping from release (continue-on-error is set).`);
        discardReleaseOutput(outputStatus.output, app.label);
        skippedLabels.push(app.label);
        continue;
      }
      missing.push(`${app.label}: ${outputStatus.reason}`);
      continue;
    }
    successCount += 1;
    successfulLabels.push(app.label);
  }

  if (continueOnError && successCount === 0) {
    throw new Error(`Release outputs are incomplete: all targets failed to build. Nothing to release.`);
  }

  if (missing.length) {
    throw new Error(`Release outputs are incomplete:\n- ${missing.join("\n- ")}`);
  }

  const summary = successfulLabels.length
    ? `Release outputs complete for ${successfulLabels.join(", ")}.`
    : "No release outputs were produced.";
  console.log(skippedLabels.length ? `${summary} Skipped ${skippedLabels.join(", ")}.` : summary);
}

async function inspectReleaseOutput(app) {
  await resolveRootPatchedOutput(app);
  const result = await readJson(app.result);
  const output = result?.output ? resolveMaybeRoot(result.output) : app.output;

  if (!result) {
    return {
      ok: false,
      output,
      reason: `missing result JSON at ${relative(app.result)}`,
    };
  }
  if (result.success === false) {
    return {
      ok: false,
      output,
      reason: `build result is unsuccessful${result.error ? ` (${firstReasonLine(result.error)})` : ""}`,
    };
  }
  if (!result.artifactName) {
    return {
      ok: false,
      output,
      reason: "result JSON is missing artifactName",
    };
  }

  const appliedPatches = patchesFrom(result.appliedPatches);
  const failedPatches = failedPatchesFrom(result.failedPatches);
  if (appliedPatches.length === 0) {
    return {
      ok: false,
      output,
      reason: "no patches were applied",
    };
  }
  if (failedPatches.length > appliedPatches.length) {
    return {
      ok: false,
      output,
      reason: `mostly failed patch result (${appliedPatches.length} applied, ${failedPatches.length} failed)`,
    };
  }
  if (!usableFile(output)) {
    return {
      ok: false,
      output,
      reason: `missing artifact file ${relative(output)}`,
    };
  }

  app.output = output;
  return { ok: true, output, result };
}

function discardReleaseOutput(output, label) {
  if (!output || !existsSync(output)) return;
  rmSync(output, { force: true });
  console.warn(`warning: ${label}: removed skipped release output ${relative(output)}.`);
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
  run("java", args, { captureOutput: true });
  if (rootBuild) {
    await assertRootPackageName(app);
    await renameVersionedBuildOutput(app, "root");
  } else {
    await renameVersionedBuildOutput(app);
  }
}

async function writeBuildFailure(app, error) {
  mkdirSync(dirname(app.result), { recursive: true });
  const existing = await readJson(app.result);
  await writeJson(app.result, {
    ...(existing || {}),
    app: app.id,
    baseApp: app.baseId || app.id,
    label: app.label,
    artifactAbi: app.artifactAbi,
    packageName: existing?.packageName || app.packageName,
    success: false,
    error: existing?.error || error.message,
    errorOutputTail: existing?.errorOutputTail || error.outputTail,
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

async function renameVersionedBuildOutput(app, variant = "patched") {
  if (truthy(env("MORPHE_DISABLE_VERSIONED_OUTPUTS"))) return;
  if (!usableFile(app.output)) return;

  const appVersion = await appVersionFor(app);
  const safeVersion = safeVersionForFile(appVersion);
  const destination = join(dirname(app.output), `${app.id}-${safeVersion}-${variant}.apk`);

  if (resolve(destination) !== resolve(app.output)) {
    rmSync(destination, { force: true });
    renameSync(app.output, destination);
    app.output = destination;
    console.log(`${app.label}: renamed APK output to ${relative(app.output)}`);
  }

  await updateBuildResultOutput(app);
}

async function updateBuildResultOutput(app) {
  const result = await readJson(app.result);
  if (!result) return;

  await writeJson(app.result, {
    ...result,
    output: relative(app.output),
    artifactName: basename(app.output),
    artifactAbi: app.artifactAbi,
    baseApp: app.baseId || app.id,
  });
}

async function appVersionFor(app) {
  const result = await readJson(app.result);
  const apkMeta = await readApkMetadata(app);
  return result?.packageVersion || apkMeta?.version || "unknown";
}

async function packageRootModules() {
  checkJava();
  const apps = selectedApps();
  const continueOnError = shouldContinueBuildOnError();
  const stagingRoot = fromRoot(".cache/root-modules");
  const versionCode = releaseVersionCode();

  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(paths.rootModules, { recursive: true });

  const packaged = [];
  const packageable = [];
  const missing = [];
  const skippedLabels = [];
  for (const app of apps) {
    const outputStatus = await inspectReleaseOutput(app);
    if (!outputStatus.ok) {
      if (continueOnError) {
        console.warn(`warning: ${app.label}: ${outputStatus.reason} - skipping root module (continue-on-error is set).`);
        discardReleaseOutput(outputStatus.output, app.label);
        skippedLabels.push(app.label);
        continue;
      }
      missing.push(`${app.label}: ${outputStatus.reason}`);
      continue;
    }

    await resolveRootStockInput(app);
    const appVersion = await appVersionFor(app);
    const moduleVersion = releaseVersionName(appVersion);
    if (!usableFile(app.input) || !rootStockInputExtensions.has(extname(app.input).toLowerCase())) {
      const reason = `root modules need the original stock APK or APK split archive at ${relative(app.input)} so the package can be registered before bind mounting`;
      if (continueOnError) {
        console.warn(`warning: ${app.label}: ${reason} - skipping root module (continue-on-error is set).`);
        skippedLabels.push(app.label);
        continue;
      }
      missing.push(`${app.label}: ${reason}`);
      continue;
    }

    packageable.push({ app, appVersion, moduleVersion });
  }

  if (continueOnError && packageable.length === 0) {
    throw new Error("Root module outputs are incomplete: all selected targets failed to build. Nothing to package.");
  }

  if (missing.length) {
    throw new Error(`Root module outputs are incomplete:\n- ${missing.join("\n- ")}`);
  }

  for (const { app, appVersion, moduleVersion } of packageable) {
    const moduleDir = join(stagingRoot, app.id);
    createRootModule(moduleDir, {
      id: app.rootModuleId,
      name: app.rootModuleName,
      version: moduleVersion,
      versionCode,
      description: `${app.label} root module by mistu. Installs the patched APK with the original package name and detaches Play Store updates.`,
      apps: [app],
    });

    const zip = join(paths.rootModules, `${app.id}-${safeVersionForFile(appVersion)}-root-module.zip`);
    createZip(moduleDir, zip);
    packaged.push({ app, appVersion, file: zip });
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
    modules: packaged.map(({ file }) => relative(file)),
    targets: packaged.map(({ app, appVersion, file }) => ({
      id: app.id,
      baseId: app.baseId || app.id,
      label: app.label,
      abi: app.artifactAbi,
      apkMirrorArch: app.apkmirrorArch,
      version: appVersion,
      packageName: app.packageName,
      modulePath: app.rootApkPath,
      apk: relative(app.output),
      module: relative(file),
    })),
  });

  if (skippedLabels.length) {
    console.warn(`warning: skipped root modules for ${skippedLabels.join(", ")}.`);
  }
}

async function resolveRootPatchedOutput(app) {
  if (usableFile(app.output)) return;

  const result = await readJson(app.result);
  const resultOutput = result?.output ? resolveMaybeRoot(result.output) : "";
  if (resultOutput && usableFile(resultOutput)) {
    app.output = resultOutput;
    return;
  }

  if (result?.output) {
    console.warn(`${app.label}: build result points to missing patched APK ${relative(resultOutput)}.`);
  }
}

async function resolveRootStockInput(app) {
  if (usableFile(app.input)) return;

  const metadata = await readApkMetadata(app);
  const metadataDestination = metadata?.destination ? resolveMaybeRoot(metadata.destination) : "";
  if (metadataDestination && usableFile(metadataDestination)) {
    app.input = metadataDestination;
    return;
  }

  if (metadata?.destination) {
    console.warn(`${app.label}: cached APK metadata points to missing stock input ${relative(metadataDestination)}.`);
  }
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
  if (!force && await cachedReleaseAssetUsable(config)) {
    return config.output;
  }

  const version = env(config.versionEnv) || "latest";
  const release = await releaseForVersion(config, version, {
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
    provider: release.provider || config.provider || "github",
    tag: release.tag_name,
    url: release.html_url || releaseUrl(config, release.tag_name),
    asset: asset.name,
    downloadedAt: new Date().toISOString(),
  });

  return config.output;
}

async function cachedReleaseAssetUsable(config) {
  if (!usableFile(config.output)) return false;

  const meta = await readJson(config.meta);
  return meta?.repo === config.repo && (meta?.provider || "github") === (config.provider || "github");
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

async function releaseForVersion(config, version = "latest", options = {}) {
  const provider = config.provider || "github";
  if (provider === "github") {
    return {
      ...await githubReleaseForVersion(config.repo, version, options),
      provider,
    };
  }
  if (provider === "gitlab") {
    return gitlabReleaseForVersion(config.repo, version, options);
  }
  throw new Error(`Unsupported release provider "${provider}" for ${config.repo}`);
}

async function gitlabReleaseForVersion(project, version = "latest", { prereleaseKeyword = false } = {}) {
  const normalized = String(version || "latest").toLowerCase();
  const releases = await gitlabJson(`https://gitlab.com/api/v4/projects/${encodeURIComponent(project)}/releases?per_page=100`);
  const stableRelease = (item) => !/(?:^|[.-])(?:dev|pre|preview|alpha|beta|rc)(?:[.-]|\d|$)/i.test(item.tag_name || "");
  let release = null;

  if (normalized === "latest" || normalized === "stable") {
    release = releases.find(stableRelease) || releases[0];
  } else if (prereleaseKeyword && ["dev", "pre", "preview", "prerelease", "pre-release"].includes(normalized)) {
    release = releases.find((item) => !stableRelease(item));
  } else {
    const tag = normalizeTag(version);
    release = releases.find((item) => item.tag_name === tag)
      || await gitlabJson(`https://gitlab.com/api/v4/projects/${encodeURIComponent(project)}/releases/${encodeURIComponent(tag)}`);
  }

  if (!release) {
    throw new Error(`No GitLab release found for ${project} ${version}`);
  }

  return normalizeGitlabRelease(project, release);
}

function normalizeGitlabRelease(project, release) {
  const links = release?.assets?.links || [];
  return {
    provider: "gitlab",
    tag_name: release.tag_name,
    html_url: `https://gitlab.com/${project}/-/releases/${encodeURIComponent(release.tag_name)}`,
    assets: links.map((link) => ({
      name: link.name,
      browser_download_url: link.direct_asset_url || link.url,
    })),
  };
}

function githubReleaseUrl(repo, tag, fallbackUrl = "") {
  if (fallbackUrl) return fallbackUrl;
  if (!tag || ["latest", "stable", "dev", "pre", "preview", "prerelease", "pre-release"].includes(String(tag).toLowerCase())) {
    return `https://github.com/${repo}/releases`;
  }
  return `https://github.com/${repo}/releases/tag/${encodeURIComponent(normalizeTag(tag))}`;
}

function gitlabReleaseUrl(project, tag, fallbackUrl = "") {
  if (fallbackUrl) return fallbackUrl;
  if (!tag || ["latest", "stable", "dev", "pre", "preview", "prerelease", "pre-release"].includes(String(tag).toLowerCase())) {
    return `https://gitlab.com/${project}/-/releases`;
  }
  return `https://gitlab.com/${project}/-/releases/${encodeURIComponent(normalizeTag(tag))}`;
}

function releaseUrl(config, tag, fallbackUrl = "") {
  return (config.provider || "github") === "gitlab"
    ? gitlabReleaseUrl(config.repo, tag, fallbackUrl)
    : githubReleaseUrl(config.repo, tag, fallbackUrl);
}

async function fetchPatchesList() {
  patchesListPromise ||= (async () => {
    const tag = await selectedPatchReleaseTag();
    return fetchPatchListForTag(releaseAssets.patches, tag);
  })();
  return patchesListPromise;
}

async function fetchPatchListForTag(config, tag) {
  if ((config.provider || "github") === "gitlab") {
    return gitlabJson(`https://gitlab.com/${config.repo}/-/raw/${encodeURIComponent(tag)}/patches-list.json`);
  }
  return githubJson(`https://raw.githubusercontent.com/${config.repo}/${tag}/patches-list.json`);
}

async function selectedPatchReleaseTag() {
  const version = env("MORPHE_PATCHES_VERSION") || "latest";

  selectedPatchReleaseTagPromise ||= (async () => {
    const release = await releaseForVersion(releaseAssets.patches, version, {
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
    releaseForVersion(releaseAssets.patches, "stable"),
    releaseForVersion(releaseAssets.patches, "dev", { prereleaseKeyword: true }).catch(() => null),
    fetchPatchesList(),
  ]);

  console.log(`Morphe CLI latest: ${cliRelease.tag_name}`);
  console.log(`Patches repo: ${patchesRepo}`);
  console.log(`Patches stable: ${patchesRelease.tag_name}`);
  console.log(`Patches dev: ${patchesDevRelease?.tag_name || "none"}`);
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
  return (await desiredApkVersions(app, patchesList))[0] || "";
}

async function desiredApkVersions(app, patchesList = null) {
  if (app.requestedVersion) return [app.requestedVersion];

  const source = (env("APK_VERSION_SOURCE") || "recommended").toLowerCase();
  if (source === "latest-compatible" || (source === "latest" && truthy(env("APK_LATEST_COMPATIBLE_ONLY")))) {
    const list = patchesList || await fetchPatchesList();
    return compatibleVersionsFor(app, list);
  }
  if (source === "latest") return [];
  if (source === "recommended") {
    const list = patchesList || await fetchPatchesList();
    const compatible = recommendedVersionsFor(app, list);
    return compatible;
  }
  if (/^\d+(?:\.\d+)+(?:[-+][A-Za-z0-9._-]+)?$/.test(source)) return [source];

  throw new Error(`Unsupported APK_VERSION_SOURCE "${source}". Use recommended, latest-compatible, latest, or an explicit version like 20.47.62 or 11.91.0-release.0.`);
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
  const rawPatchesMeta = await readJson(releaseAssets.patches.meta);
  const patchesMeta = rawPatchesMeta?.repo === releaseAssets.patches.repo ? rawPatchesMeta : null;
  const rootModulesMeta = rootBuild ? await readJson(join(paths.rootModules, "root-modules.json")) : null;
  const patchArgs = parseJsonArrayEnv("MORPHE_EXTRA_ARGS_JSON");
  const patchesTag = patchesMeta?.tag || env("MORPHE_PATCHES_VERSION") || "latest";
  const patchesUrl = releaseUrl(releaseAssets.patches, patchesTag, patchesMeta?.url);
  const lines = [];

  lines.push(rootBuild ? "Automated root module build." : "Automated patched APK build.");
  lines.push("");
  lines.push("## Build Summary");
  lines.push("");
  lines.push(`- Targets: ${apps.map((app) => app.label).join(", ")}`);
  lines.push(`- Morphe CLI: ${cliMeta?.tag || env("MORPHE_CLI_VERSION") || "latest"}`);
  lines.push(`- Patches repo: ${releaseAssets.patches.repo}`);
  lines.push(`- Patches: [${releaseAssets.patches.repo} ${patchesTag}](${patchesUrl})`);
  lines.push(`- Build variant: ${rootBuild ? "root module" : "standard APK"}`);
  lines.push(`- YouTube ABIs: ${youtubeAbiVariants.map((variant) => variant.artifactAbi).join(", ")}`);
  const apkVersionSource = (env("APK_VERSION_SOURCE") || "recommended").toLowerCase();
  lines.push(`- APK version source: ${env("APK_VERSION_SOURCE") || "recommended"}`);
  if (apkVersionSource === "latest-compatible" || (apkVersionSource === "latest" && truthy(env("APK_LATEST_COMPATIBLE_ONLY")))) {
    lines.push("- APK latest mode: constrained to patch-compatible versions");
  }
  lines.push(`- Recommended APK fallback to latest: ${truthy(env("APK_FALLBACK_TO_LATEST")) ? "enabled" : "disabled"}`);
  lines.push(`- Patch args: ${patchArgs.length ? patchArgs.join(" ") : "none"}`);
  if (rootBuild) {
    lines.push("- Root modules: Magisk, KernelSU, and APatch compatible ZIPs.");
  }
  lines.push("");
  lines.push("## App Results");
  lines.push("");

  let totalApplied = 0;
  let totalFailed = 0;

  for (const app of apps) {
    const result = await readJson(app.result);
    const apkMeta = await readApkMetadata(app);
    const apkVersion = result?.packageVersion || apkMeta?.version || "unknown";
    const sourcePackageName = result?.packageName || app.packageName;
    const packageName = rootBuild ? app.packageName : app.patchedPackageName || sourcePackageName;
    const applied = patchesFrom(result?.appliedPatches);
    const failed = failedPatchesFrom(result?.failedPatches);
    const stepFailures = stepFailuresFrom(result?.patchingSteps);
    totalApplied += applied.length;
    totalFailed += failed.length;
    const buildResult = result
      ? result.success === false
        ? "completed with patch failures"
        : applied.length === 0
          ? "completed without applied patches"
          : "successful"
      : "unknown; result file missing";

    const sourceParts = [];
    if (apkMeta?.source) sourceParts.push(apkSourceLabel(apkMeta.source));
    if (apkMeta?.filename) sourceParts.push(apkMeta.filename);
    if (apkMeta?.fallbackFromVersion) sourceParts.push(`fallback from ${apkMeta.fallbackFromVersion}`);
    if (apkMeta?.forcePatchRequired) sourceParts.push("--force");

    lines.push(`- ${app.label} ${apkVersion}: ${buildResult}; patches ${applied.length} succeeded, ${failed.length} failed`);
    lines.push(`  - Package: ${packageName}${sourcePackageName !== packageName ? ` (source ${sourcePackageName})` : ""}`);
    if (app.artifactAbi || result?.artifactAbi || apkMeta?.arch) {
      const abi = app.artifactAbi || result?.artifactAbi || apkMeta?.arch;
      const sourceArch = apkMeta?.arch && apkMeta.arch !== abi ? `; source arch ${apkMeta.arch}` : "";
      lines.push(`  - ABI: ${abi}${sourceArch}`);
    }
    if (rootBuild) lines.push(`  - Module path: /${app.rootApkPath}`);
    if (result?.artifactName) lines.push(`  - Artifact: ${result.artifactName}`);
    const rootModule = rootModulesMeta?.targets?.find((target) => target.id === app.id);
    if (rootModule?.module) lines.push(`  - Root module: ${basename(rootModule.module)}`);
    if (sourceParts.length) lines.push(`  - Source: ${sourceParts.join("; ")}`);
    if (result?.success === false && result?.error) lines.push(`  - Error: ${firstReasonLine(result.error)}`);
    if (result?.success === false && result?.errorOutputTail) lines.push(`  - Error output: ${firstReasonLine(result.errorOutputTail)}`);
    if (failed.length) lines.push(`  - Failed patches: ${formatFailedPatchList(failed)}`);
    if (stepFailures.length) lines.push(`  - Failed steps: ${stepFailures.join("; ")}`);
  }

  lines.push("");
  lines.push(`Patch totals: ${totalApplied} succeeded, ${totalFailed} failed.`);

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
  const expanded = raw.toLowerCase() === "auto" ? "apkmirror,apkpure,uptodown,divxland" : raw;
  const sources = expanded
    .split(/[,\s]+/)
    .map(normalizeApkSource)
    .filter(Boolean);
  const uniqueSources = [...new Set(sources.length ? sources : ["apkpure"])];
  const supported = new Set(["apkmirror", "apkpure", "uptodown", "divxland", "local"]);
  const unknown = uniqueSources.filter((source) => !supported.has(source));

  if (unknown.length) {
    throw new Error(`Unsupported APK_SOURCE value(s): ${unknown.join(", ")}. Use apkmirror, apkpure, uptodown, divxland, local, or auto.`);
  }

  return uniqueSources;
}

function normalizeApkSource(source) {
  const normalized = source.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return {
    "apkmirror.com": "apkmirror",
    "apkpure.com": "apkpure",
    "apkpure.net": "apkpure",
    "uptodown.com": "uptodown",
    "divxland.org": "divxland",
  }[normalized] || normalized;
}

function apkSourceLabel(source) {
  const labels = {
    apkmirror: "APKMirror",
    apkpure: "APKPure",
    "apkpure-direct": "APKPure",
    "apkpure-python": "APKPure",
    apkeep: "APKPure/apkeep",
    uptodown: "Uptodown",
    divxland: "DivxLand",
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
    `${app.label} input is missing. Put it at ${relative(app.input)}, set ${envNameFor(app.id)}_URL, or set APK_SOURCE=apkmirror,apkpure,uptodown,divxland.`,
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
  if (packageNameOptionsDisabled) {
    if (truthy(env("MORPHE_CREATE_DEFAULT_OPTIONS"))) {
      const activeTools = tools || await ensureTools(flag("refresh-tools"));
      createDefaultOptionsFile(app, activeTools);
    }
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
    throw new Error(`Patches ${patchesList?.version || ""} from ${releaseAssets.patches.repo} did not include "${packageNamePatch}".`);
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
      source: `${releaseAssets.patches.repo} ${patchesList?.version || env("MORPHE_PATCHES_VERSION") || "latest"}`,
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
    stagedStockDirName: app.id,
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
    "During installation, the module registers the original package using the stock APK files, then bind-mounts the patched APK over the package base APK.",
    "The module re-applies the bind mount and Play Store detach commands at boot.",
    "This keeps the launcher entry tied to the original package while running the patched APK.",
    "",
    "Included apps:",
    ...entries.map((app) => `- ${app.label}: ${app.packageName}`),
    "",
  ].join("\n"));

  for (const app of entries) {
    const patchedDestination = join(moduleDir, "common", "patched", app.stagedPatchedApkName);
    const stockDestination = join(moduleDir, "common", "stock", app.stagedStockDirName);
    mkdirSync(dirname(patchedDestination), { recursive: true });
    copyFileSync(app.output, patchedDestination);
    stageRootStockFiles(app, stockDestination);
  }

  const commonDir = join(moduleDir, "common");
  if (existsSync(commonDir)) {
    console.log(`\n==> Compressing module resources as tar.xz (highest compression)...`);
    const archivePath = join(moduleDir, "common.tar.xz");

    const tarVersion = runCapture("tar", ["--version"]) || "";
    const isBsdtar = tarVersion.toLowerCase().includes("bsdtar") || tarVersion.toLowerCase().includes("libarchive");

    const tarArgs = ["-c", "-J", "-f", archivePath];
    if (isBsdtar) {
      tarArgs.push("--options", "compression-level=9");
    }
    tarArgs.push("common");

    const tarEnv = { ...process.env };
    if (!isBsdtar) {
      tarEnv.XZ_OPT = "-9";
    }

    const result = spawnSync("tar", tarArgs, {
      cwd: moduleDir,
      env: tarEnv,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`tar exited with status ${result.status} while compressing module APKs.`);
    }
    rmSync(commonDir, { recursive: true, force: true });
  }
}

function stageRootStockFiles(app, destinationDir) {
  rmSync(destinationDir, { recursive: true, force: true });
  mkdirSync(destinationDir, { recursive: true });

  const extension = extname(app.input).toLowerCase();
  if (extension === ".apk") {
    copyFileSync(app.input, join(destinationDir, "base.apk"));
    return;
  }

  const entries = archiveApkEntries(app.input);
  if (!entries.length) {
    throw new Error(`${app.label}: stock archive ${relative(app.input)} did not contain any APK files.`);
  }

  const extractRoot = join(paths.tmp, "root-stock", app.id);
  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });

  entries.forEach((entry, index) => {
    extractArchiveEntry(app.input, entry, extractRoot);
    const extracted = join(extractRoot, ...entry.split("/"));
    if (!usableFile(extracted)) {
      throw new Error(`${app.label}: stock archive entry ${entry} was not extracted.`);
    }

    const stagedName = stagedStockApkName(entry, index, entries.length);
    copyFileSync(extracted, join(destinationDir, stagedName));
  });
}

function archiveApkEntries(archive) {
  const output = runCapture("jar", ["--list", "--file", archive]);
  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim().replaceAll("\\", "/"))
    .filter(isSafeArchiveApkEntry);
}

function extractArchiveEntry(archive, entry, destinationDir) {
  const result = spawnSync("jar", ["--extract", "--file", archive, entry], {
    cwd: destinationDir,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`jar exited with status ${result.status}`);
  }
}

function isSafeArchiveApkEntry(entry) {
  if (!entry || entry.endsWith("/") || !entry.toLowerCase().endsWith(".apk")) return false;
  if (entry.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(entry)) return false;
  return entry.split("/").every((part) => part && part !== "." && part !== "..");
}

function stagedStockApkName(entry, index, entryCount) {
  if (entryCount === 1) return "base.apk";
  const name = basename(entry).replace(/[^A-Za-z0-9._-]/g, "_") || `split-${index + 1}.apk`;
  return `${String(index + 1).padStart(2, "0")}-${name}`;
}

function rootCustomizeScript(apps) {
  const appLines = apps.map((app) => [
    app.packageName,
    app.label,
    app.stagedPatchedApkName,
    app.stagedStockDirName,
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
    "if [ -f \"$MODPATH/common.tar.xz\" ]; then",
    "  ui_print \"  Extracting APK resources (tar.xz)...\"",
    "  tar -xf \"$MODPATH/common.tar.xz\" -C \"$MODPATH\" || abort \"Failed to extract APK resources\"",
    "  rm -f \"$MODPATH/common.tar.xz\"",
    "fi",
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
    "install_stock_session() {",
    "  local pkg=\"$1\" label=\"$2\" stock_dir=\"$3\"",
    "  local total size session out verify_adb package_verifier apk name",
    "  [ -d \"$stock_dir\" ] || abort \"Missing stock APK directory for $label: $stock_dir\"",
    "  total=0",
    "  for apk in \"$stock_dir\"/*.apk; do",
    "    [ -f \"$apk\" ] || continue",
    "    size=\"$(wc -c < \"$apk\")\"",
    "    total=$((total + size))",
    "  done",
    "  [ \"$total\" -gt 0 ] || abort \"No stock APK files found for $label in $stock_dir\"",
    "  verify_adb=\"$(settings get global verifier_verify_adb_installs 2>/dev/null)\"",
    "  package_verifier=\"$(settings get global package_verifier_enable 2>/dev/null)\"",
    "  settings put global verifier_verify_adb_installs 0 >/dev/null 2>&1 || true",
    "  settings put global package_verifier_enable 0 >/dev/null 2>&1 || true",
    "  out=\"$(pm install-create --user 0 -i com.android.vending -r -S \"$total\" 2>&1)\" || { settings put global verifier_verify_adb_installs \"$verify_adb\" >/dev/null 2>&1 || true; settings put global package_verifier_enable \"$package_verifier\" >/dev/null 2>&1 || true; ui_print \"$out\"; return 1; }",
    "  session=\"${out#*[}\"",
    "  session=\"${session%]*}\"",
    "  for apk in \"$stock_dir\"/*.apk; do",
    "    [ -f \"$apk\" ] || continue",
    "    size=\"$(wc -c < \"$apk\")\"",
    "    name=\"${apk##*/}\"",
    "    out=\"$(pm install-write -S \"$size\" \"$session\" \"$name\" \"$apk\" 2>&1)\" || { pm install-abandon \"$session\" >/dev/null 2>&1 || true; settings put global verifier_verify_adb_installs \"$verify_adb\" >/dev/null 2>&1 || true; settings put global package_verifier_enable \"$package_verifier\" >/dev/null 2>&1 || true; ui_print \"$out\"; return 1; }",
    "  done",
    "  out=\"$(pm install-commit \"$session\" 2>&1)\" || { settings put global verifier_verify_adb_installs \"$verify_adb\" >/dev/null 2>&1 || true; settings put global package_verifier_enable \"$package_verifier\" >/dev/null 2>&1 || true; ui_print \"$out\"; return 1; }",
    "  settings put global verifier_verify_adb_installs \"$verify_adb\" >/dev/null 2>&1 || true",
    "  settings put global package_verifier_enable \"$package_verifier\" >/dev/null 2>&1 || true",
    "}",
    "",
    "install_stock_package() {",
    "  local pkg=\"$1\" label=\"$2\" stock_dir=\"$3\"",
    "  local existing_base",
    "  [ -d \"$stock_dir\" ] || abort \"Missing stock APK directory for $label: $stock_dir\"",
    "  uninstall_system_updates_if_needed \"$pkg\"",
    "  existing_base=\"$(pm_base_path \"$pkg\")\"",
    "  if [ -n \"$existing_base\" ]; then",
    "    ui_print \"  Refreshing original package registration\"",
    "    if ! install_stock_session \"$pkg\" \"$label\" \"$stock_dir\"; then",
    "      ui_print \"  Stock refresh failed; keeping existing package registration\"",
    "    fi",
    "    enable_package \"$pkg\"",
    "    return 0",
    "  fi",
    "  ui_print \"  Registering original package with stock APK files\"",
    "  install_stock_session \"$pkg\" \"$label\" \"$stock_dir\" || abort \"stock package install failed for $label\"",
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
    "unmount_global() {",
    "  local target=\"$1\"",
    "  [ -n \"$target\" ] || return 0",
    "  if su -M -c true >/dev/null 2>&1; then",
    "    su -M -c \"umount '$target' || umount -l '$target'\" >/dev/null 2>&1 && return 0",
    "  fi",
    "  if command -v nsenter >/dev/null 2>&1; then",
    "    nsenter -t 1 -m umount \"$target\" >/dev/null 2>&1 && return 0",
    "    nsenter -t 1 -m umount -l \"$target\" >/dev/null 2>&1 && return 0",
    "  fi",
    "  umount \"$target\" >/dev/null 2>&1 || umount -l \"$target\" >/dev/null 2>&1 || true",
    "}",
    "",
    "stage_patched_apk() {",
    "  local source=\"$1\" target=\"$2\" tmp",
    "  tmp=\"$target.tmp.$$\"",
    "  rm -f \"$tmp\" >/dev/null 2>&1 || true",
    "  cp -f \"$source\" \"$tmp\" || { rm -f \"$tmp\" >/dev/null 2>&1 || true; return 1; }",
    "  chmod 0644 \"$tmp\"",
    "  chcon u:object_r:apk_data_file:s0 \"$tmp\" >/dev/null 2>&1 || true",
    "  mv -f \"$tmp\" \"$target\" || { rm -f \"$tmp\" >/dev/null 2>&1 || true; return 1; }",
    "  sync \"$target\" >/dev/null 2>&1 || sync >/dev/null 2>&1 || true",
    "}",
    "",
    "install_root_apk() {",
    "  local pkg=\"$1\" label=\"$2\" patched_name=\"$3\" stock_dir_name=\"$4\" fallback_path=\"$5\"",
    "  local patched_apk stock_dir persistent_apk target_path",
    "  patched_apk=\"$MODPATH/common/patched/$patched_name\"",
    "  stock_dir=\"$MODPATH/common/stock/$stock_dir_name\"",
    "  persistent_apk=\"$DATA_DIR/$pkg.apk\"",
    "  [ -f \"$patched_apk\" ] || abort \"Missing patched APK for $label: $patched_apk\"",
    "",
    "  ui_print \"- App: $label\"",
    "  ui_print \"  Package: $pkg\"",
    "  am force-stop \"$pkg\" >/dev/null 2>&1 || true",
    "  target_path=\"$(pm_base_path \"$pkg\")\"",
    "  unmount_global \"$target_path\"",
    "  install_stock_package \"$pkg\" \"$label\" \"$stock_dir\"",
    "  target_path=\"$(pm_base_path \"$pkg\")\"",
    "  [ -n \"$target_path\" ] || abort \"Package path not found after stock registration for $label\"",
    "  stage_patched_apk \"$patched_apk\" \"$persistent_apk\" || abort \"Failed to stage patched APK for $label\"",
    "  cmd package compile --reset \"$pkg\" >/dev/null 2>&1 || true",
    "  unmount_global \"$target_path\"",
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
    "unmount_global() {",
    "  local target=\"$1\"",
    "  [ -n \"$target\" ] || return 0",
    "  if su -M -c true >/dev/null 2>&1; then",
    "    su -M -c \"umount '$target' || umount -l '$target'\" >/dev/null 2>&1 && return 0",
    "  fi",
    "  if command -v nsenter >/dev/null 2>&1; then",
    "    nsenter -t 1 -m umount \"$target\" >/dev/null 2>&1 && return 0",
    "    nsenter -t 1 -m umount -l \"$target\" >/dev/null 2>&1 && return 0",
    "  fi",
    "  umount \"$target\" >/dev/null 2>&1 || umount -l \"$target\" >/dev/null 2>&1 || true",
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
    "  cmd package compile --reset \"$pkg\" >/dev/null 2>&1 || true",
    "  unmount_global \"$target_path\"",
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

function releaseVersionName(fallbackVersion = "") {
  return env("ROOT_MODULE_VERSION") || fallbackVersion || new Date().toISOString().slice(0, 10);
}

function releaseVersionCode() {
  const explicit = env("ROOT_MODULE_VERSION_CODE");
  if (explicit) return explicit;
  return String(Math.floor(Date.now() / 1000));
}

async function downloadApkApp(app, { force = false, patchesList = null } = {}) {
  const sources = apkDownloadSourcesFor(app);
  if (!sources.length) {
    const requirement = app.artifactAbi ? " ABI-specific APK downloads require APK_SOURCE to include apkmirror, uptodown, or divxland." : "";
    throw new Error(`${app.label}: APK_SOURCE does not include a downloadable source.${requirement}`);
  }

  mkdirSync(paths.apks, { recursive: true });
  mkdirSync(dirname(app.input), { recursive: true });

  const desiredVersions = await desiredApkVersions(app, patchesList);
  const desiredVersion = desiredVersions[0] || "";
  const metadataFile = metadataFileFor(app);
  const existing = await readApkMetadata(app);

  if (desiredVersions.length) {
    const exactErrors = [];
    for (const selectedVersion of desiredVersions) {
      if (selectedVersion !== desiredVersion) {
        console.warn(`${app.label}: trying next compatible recommended APK version ${selectedVersion}.`);
      }

      for (const source of sources) {
        try {
          return await downloadExactApkFromSource(source, app, {
            selectedVersion,
            force,
            patchesList,
            metadataFile,
            existing,
            desiredVersion: selectedVersion,
          });
        } catch (error) {
          exactErrors.push(`${apkSourceLabel(source)} ${selectedVersion}: ${error.message}`);
        }
      }
    }

    if (!shouldFallbackToLatest(app)) {
      throw new Error(`${app.label}: no exact compatible APK could be downloaded for ${desiredVersions.join(", ")}. ${exactErrors.join(" | ")}`);
    }

    const fallbackReason = exactErrors.join(" | ");
    console.warn(`${app.label}: exact compatible APK could not be downloaded from configured sources: ${fallbackReason}`);
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

function apkDownloadSourcesFor(app) {
  const sources = apkSources().filter((source) => source !== "local");
  if (!app.artifactAbi) return sources;

  const allowed = ["apkmirror", "uptodown", "divxland"];
  if (truthy(env("MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI"))) allowed.push("apkpure");
  return sources.filter((source) => allowed.includes(source));
}

async function downloadExactApkFromSource(source, app, options) {
  if (source === "apkmirror") return downloadWithPythonApkmirror(app, options);
  if (source === "apkpure") return downloadWithPythonApkpure(app, options);
  if (source === "uptodown") return downloadWithUptodown(app, options);
  if (source === "divxland") return downloadWithDivxland(app, options);
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

      if (source === "uptodown") {
        return await downloadWithUptodown(app, {
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

      if (source === "divxland") {
        return await downloadWithDivxland(app, {
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
    baseApp: app.baseId || app.id,
    artifactAbi: app.artifactAbi,
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
    (selectedVersion ? existing?.version === selectedVersion : true) &&
    existingApkmirrorInputMatches(app, existing)
  ) {
    app.input = existing.destination;
    console.log(`${app.label} ${existing.version || requestedLabel} already downloaded from APKMirror at ${relative(app.input)}`);
    return;
  }

  const outputDir = fromRoot(".cache/apkmirror", app.id);
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const apkmirrorType = (app.apkmirrorType || "apk").toLowerCase();
  const apkmirrorExtension = apkmirrorType === "bundle" ? "apkm" : "apk";

  let metadata;
  try {
    metadata = downloadApkmirrorVariant(app, {
      outputDir,
      requestedLabel,
      type: apkmirrorType,
      arch: app.apkmirrorArch,
      dpi: app.apkmirrorDpi,
      outFile: `${app.id}-${requestedLabel}.${apkmirrorExtension}`,
      fallbackArch: app.apkmirrorFallbackArch,
    });
  } catch (error) {
    if (!shouldRetryApkmirrorUniversalApk(app, apkmirrorType, error)) throw error;

    console.warn(`${app.label}: ${error.message}`);
    console.warn(`${app.label}: retrying APKMirror with exact-version universal APK fallback.`);
    metadata = downloadApkmirrorVariant(app, {
      outputDir,
      requestedLabel,
      type: "apk",
      arch: "universal",
      dpi: "any",
      outFile: `${app.id}-${requestedLabel}-universal.apk`,
      fallbackArch: "",
    });
    metadata.artifactAbiFallback = "universal-apk";
  }

  if (selectedVersion && !versionsMatch(metadata.version, selectedVersion)) {
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
    baseApp: app.baseId || app.id,
    artifactAbi: app.artifactAbi,
    packageName: app.packageName,
    sourcePage: metadata.sourcePage,
    source: "apkmirror",
    directUrl: metadata.downloadUrl,
    directUrls: metadata.downloadUrls,
    downloadPage: metadata.downloadPage,
    downloadPages: metadata.downloadPages,
    variantPage: metadata.variantPage,
    variantPages: metadata.variantPages,
    destination,
    version: metadata.version,
    versionCode: metadata.versionCode,
    fileType: metadata.fileType,
    arch: metadata.arch,
    dpi: metadata.dpi,
    artifactAbiFallback: metadata.artifactAbiFallback,
    minAndroidVersion: metadata.minAndroidVersion,
    variants: metadata.variants,
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
  let metadata;
  try {
    metadata = runPythonJson([
      fromRoot("scripts/apkpure_download.py"),
      "--app-name",
      app.apkpureName,
      "--package-name",
      app.packageName,
      "--source-page",
      app.apkpurePage,
      "--out-dir",
      outputDir,
      ...(app.apkmirrorArch ? ["--arch", app.apkmirrorArch] : []),
      ...(selectedVersion ? ["--version", selectedVersion] : []),
    ]);
  } catch (error) {
    if (!selectedVersion) throw error;

    console.warn(`${app.label}: Python APKPure download failed: ${error.message}`);
    console.warn(`${app.label}: retrying APKPure exact version with apkeep.`);
    return downloadWithApkeep(app, {
      desiredVersion: selectedVersion,
      force,
      patchesList,
      metadataFile,
      existing,
    });
  }

  if (selectedVersion && !versionsMatch(metadata.version, selectedVersion)) {
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
    baseApp: app.baseId || app.id,
    artifactAbi: app.artifactAbi,
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

async function downloadWithUptodown(
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
  const sourcePage = selectedVersion
    ? await uptodownExactDownloadPage(app, selectedVersion)
    : uptodownDownloadPage(app);
  const page = await fetchText(sourcePage, uptodownHeaders());
  const selected = parseUptodownDownloadPage(app, sourcePage, page);

  if (selectedVersion && !versionsMatch(selected.version, selectedVersion)) {
    throw new Error(`${app.label}: Uptodown downloaded page version ${selected.version || "unknown"}, expected ${selectedVersion}.`);
  }

  if (
    !force &&
    existing?.source === "uptodown" &&
    existing?.version === selected.version &&
    existing?.destination &&
    existsSync(existing.destination)
  ) {
    app.input = existing.destination;
    console.log(`${app.label} ${selected.version || "latest"} already downloaded from Uptodown at ${relative(app.input)}`);
    return;
  }

  const extension = extensionFromDownload(selected.directUrl, "apk");
  const destination = replaceExtension(app.input, extension);
  console.log(`Downloading Uptodown ${app.label} ${selected.version || "latest"}`);
  rmSync(destination, { force: true });
  const downloaded = await downloadFile(selected.directUrl, destination, {
    ...uptodownHeaders(),
    Referer: sourcePage,
  });
  app.input = destination;

  const list = patchesList || await fetchPatchesList();
  const topRecommendedVersion = recommendedVersionFor(app, list);
  const compatible = compatibleVersionsFor(app, list);

  await writeJson(metadataFile, {
    app: app.id,
    baseApp: app.baseId || app.id,
    artifactAbi: app.artifactAbi,
    packageName: app.packageName,
    sourcePage,
    source: "uptodown",
    directUrl: downloaded.url || selected.directUrl,
    destination,
    version: selected.version,
    versionCode: selected.versionCode,
    fileType: extension.replace(/^\./, "").toUpperCase(),
    arch: "universal",
    dpi: "unknown",
    artifactAbiFallback: app.artifactAbi ? "universal-apk" : undefined,
    desiredVersion,
    fallbackFromVersion,
    fallbackReason,
    forcePatchRequired,
    morpheTopRecommendedVersion: topRecommendedVersion,
    availableCompatibleVersions: compatible.filter((version) => version === selected.version),
    filename: basename(destination),
    size: selected.size || formatBytes(Number(downloaded.headers?.get("content-length") || 0)),
    downloadedAt: new Date().toISOString(),
  });
}

async function downloadWithDivxland(
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
  const sourcePage = divxlandDownloadPage(app);
  const page = await fetchText(sourcePage, divxlandHeaders(sourcePage));
  let selected = parseDivxlandDownloadPage(app, sourcePage, page);
  if (selected.needsIntermediateFetch) {
    const intermediate = await fetchText(selected.downloadPage, divxlandHeaders(sourcePage));
    selected = parseDivxlandIntermediatePage(app, sourcePage, selected.downloadPage, selected.version, selected.size, intermediate);
  }
  if (!selected.keyUrl || !selected.postId) {
    throw new Error(`${app.label}: DivxLand download key metadata was not found at ${selected.downloadPage}.`);
  }

  if (selectedVersion && !versionsMatch(selected.version, selectedVersion)) {
    throw new Error(`${app.label}: DivxLand only exposed ${selected.version || "unknown"} on its download page, expected exact version ${selectedVersion}.`);
  }

  if (
    !force &&
    existing?.source === "divxland" &&
    existing?.version === selected.version &&
    existing?.destination &&
    existsSync(existing.destination)
  ) {
    app.input = existing.destination;
    console.log(`${app.label} ${selected.version || "latest"} already downloaded from DivxLand at ${relative(app.input)}`);
    return;
  }

  const keyResponse = await fetchWithRetry(selected.keyUrl, {
    method: "POST",
    headers: divxlandHeaders(selected.downloadPage, { "Content-Type": "application/json" }),
    body: JSON.stringify({ post_id: selected.postId }),
  });
  if (!keyResponse.ok) {
    throw new Error(`${app.label}: DivxLand key request failed (${keyResponse.status})`);
  }
  const keyData = await keyResponse.json();
  const directUrl = resolveUrl(selected.downloadPage, keyData?.url || "");
  if (!directUrl) {
    throw new Error(`${app.label}: DivxLand key response did not include a download URL.`);
  }

  const extension = extensionFromDownload(directUrl, "apk");
  const destination = replaceExtension(app.input, extension);
  console.log(`Downloading DivxLand ${app.label} ${selected.version || "latest"}`);
  rmSync(destination, { force: true });
  const downloaded = await downloadFile(directUrl, destination, divxlandHeaders(selected.downloadPage));
  app.input = destination;

  const list = patchesList || await fetchPatchesList();
  const topRecommendedVersion = recommendedVersionFor(app, list);
  const compatible = compatibleVersionsFor(app, list);

  await writeJson(metadataFile, {
    app: app.id,
    baseApp: app.baseId || app.id,
    artifactAbi: app.artifactAbi,
    packageName: app.packageName,
    sourcePage,
    source: "divxland",
    directUrl: downloaded.url || directUrl,
    downloadPage: selected.downloadPage,
    keyUrl: selected.keyUrl,
    destination,
    version: selected.version,
    fileType: extension.replace(/^\./, "").toUpperCase(),
    arch: "universal",
    dpi: "unknown",
    artifactAbiFallback: app.artifactAbi ? "universal-apk" : undefined,
    desiredVersion,
    fallbackFromVersion,
    fallbackReason,
    forcePatchRequired,
    morpheTopRecommendedVersion: topRecommendedVersion,
    availableCompatibleVersions: compatible.filter((version) => version === selected.version),
    filename: basename(destination),
    size: selected.size || formatBytes(Number(downloaded.headers?.get("content-length") || 0)),
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
      `Patch-list top recommended version: ${topRecommendedVersion || "unknown"}. ` +
      `Patch-compatible versions: ${compatible.join(", ") || "none"}. ` +
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
    baseApp: app.baseId || app.id,
    artifactAbi: app.artifactAbi,
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

function run(commandName, args, { captureOutput = false } = {}) {
  if (captureOutput) return runWithCapturedOutput(commandName, args);

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

function runWithCapturedOutput(commandName, args) {
  const result = spawnSync(commandName, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.error) {
    result.error.outputTail = commandOutputTail(output);
    throw result.error;
  }
  if (result.status !== 0) {
    const tail = commandOutputTail(output);
    const summary = commandOutputSummary(tail);
    const error = new Error(`${commandName} exited with status ${result.status}${summary ? `: ${summary}` : ""}`);
    error.outputTail = tail;
    throw error;
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

async function gitlabJson(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "morph-youtube-builder",
      ...(env("GITLAB_TOKEN") ? { "PRIVATE-TOKEN": env("GITLAB_TOKEN") } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab request failed (${response.status}) for ${url}`);
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
  return { url: response.url, headers: response.headers };
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
  node scripts/morphe.mjs build [--target youtube] [-- <morphe-cli patch args>]
  node scripts/morphe.mjs download [--target youtube] [--force-download]
  node scripts/morphe.mjs options [--target youtube] [--target reddit]
  node scripts/morphe.mjs tools [--refresh-tools]
  node scripts/morphe.mjs versions
  node scripts/morphe.mjs release-notes
  node scripts/morphe.mjs release-check
  node scripts/morphe.mjs root-modules
  node scripts/morphe.mjs clean

Environment:
  BUILD_TARGETS              Comma-separated targets. Defaults to youtube,youtube-music,reddit.
                             youtube and youtube-music expand according to YOUTUBE_ABIS.
  YOUTUBE_ABIS               YouTube/YouTube Music ABI artifacts. Defaults to
                             arm64-v8a,arm-v7a. Use arm64-v8a for v8a-only builds.
  MORPHE_CLI_VERSION         Release tag such as v1.7.0, or latest.
  MORPHE_PATCHES_VERSION     stable, dev, latest, or a release tag such as v1.24.0.
  MORPHE_PATCHES_REPO        Patch bundle repo. Defaults to MorpheApp/morphe-patches.
  YOUTUBE_APK                Local input path for YouTube.
  YOUTUBE_MUSIC_APK          Local input path for YouTube Music.
  REDDIT_APK                 Local input path for Reddit.
  YOUTUBE_APK_URL            Private direct URL for CI input.
  YOUTUBE_MUSIC_APK_URL      Private direct URL for CI input.
  REDDIT_APK_URL             Private direct URL for CI input.
  APK_SOURCE                 Comma-separated source order: apkmirror, apkpure, uptodown,
                              divxland, local, or auto.
                              Defaults to apkpure.
  APK_VERSION_SOURCE         recommended, latest-compatible, latest, or an explicit
                             version such as 20.47.62 or 11.91.0-release.0.
                             Defaults to recommended.
  APK_LATEST_COMPATIBLE_ONLY Set to 1 with APK_VERSION_SOURCE=latest to use the newest
                             patch-compatible APK instead of the newest available APK.
  APK_FALLBACK_TO_LATEST     Set to 1 to fall back to latest if the recommended APK is unavailable.
  MORPHE_INCLUDE_EXPERIMENTAL_TARGETS
                             Set to 1 to allow experimental patch target versions.
  YOUTUBE_APK_VERSION        Explicit YouTube APK versionName override.
  YOUTUBE_ARM64_V8A_APK_VERSION
                             Explicit YouTube arm64-v8a APK versionName override.
  YOUTUBE_ARM_V7A_APK_VERSION
                             Explicit YouTube arm-v7a APK versionName override.
  YOUTUBE_MUSIC_APK_VERSION  Explicit YouTube Music APK versionName override.
  YOUTUBE_MUSIC_ARM64_V8A_APK_VERSION
                             Explicit YouTube Music arm64-v8a APK versionName override.
  YOUTUBE_MUSIC_ARM_V7A_APK_VERSION
                             Explicit YouTube Music arm-v7a APK versionName override.
  REDDIT_APK_VERSION         Explicit Reddit APK versionName override.
  APKMIRROR_ARCH             Optional APKMirror architecture override. Comma-separated values
                             are combined when APKMIRROR_TYPE is bundle.
  APKMIRROR_DPI              Optional APKMirror DPI override. Defaults vary by target.
  APKMIRROR_TYPE             Optional APKMirror type override: apk or bundle.
  <TARGET>_UPTODOWN_SLUG     Optional Uptodown subdomain slug override.
  <TARGET>_DIVXLAND_SLUG     Optional DivxLand subdomain slug override.
  YOUTUBE_APKMIRROR_ARCH     YouTube APKMirror architecture override for both ABI artifacts.
                             Defaults to arm64-v8a and armeabi-v7a as separate builds.
  YOUTUBE_ARM64_V8A_APKMIRROR_ARCH
                             YouTube arm64-v8a APKMirror architecture override.
  YOUTUBE_ARM_V7A_APKMIRROR_ARCH
                             YouTube arm-v7a APKMirror architecture override.
  YOUTUBE_MUSIC_APKMIRROR_ARCH
                              YouTube Music APKMirror architecture override for both ABI artifacts.
                              Defaults to arm64-v8a and armeabi-v7a as separate builds.
  YOUTUBE_MUSIC_ARM64_V8A_APKMIRROR_ARCH
                              YouTube Music arm64-v8a APKMirror architecture override.
  YOUTUBE_MUSIC_ARM_V7A_APKMIRROR_ARCH
                              YouTube Music arm-v7a APKMirror architecture override.
  REDDIT_APKMIRROR_TYPE      Reddit APKMirror file type. Defaults to bundle.
  REDDIT_APKMIRROR_ARCH      Reddit APKMirror architecture. Defaults to universal.
  REDDIT_APKMIRROR_DPI       Reddit APKMirror DPI. Defaults to 120-640dpi.
  YOUTUBE_PATCHED_PACKAGE_NAME
                              Defaults to com.mistu.android.youtube.
  YOUTUBE_MUSIC_PATCHED_PACKAGE_NAME
                              Defaults to com.mistu.android.youtube.music.
  REDDIT_PATCHED_PACKAGE_NAME
                              Optional; only works if the selected patch bundle supports it.
  MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS
                              Set to 1 to skip generated package rename options for patch bundles
                              that manage clone package names through other patches.
  MORPHE_CREATE_DEFAULT_OPTIONS
                              Set to 1 to create and pass default patch option files.
  ROOT_BUILD                  Set to 1 for root module builds that keep original package names.
  ROOT_ALLOW_OPTIONS_FILE     Set to 1 to pass root build options files. Defaults to off.
  ROOT_MODULE_VERSION         Optional module version label. Defaults to current UTC date.
  ROOT_MODULE_VERSION_CODE    Optional numeric module versionCode.
  AUTO_UPDATE_APKS           Set to 1 to refresh existing APK downloads during build.
  MORPHE_CONTINUE_ON_ERROR   Set to 1 to keep building later targets after a target fails.
  MORPHE_DISABLE_VERSIONED_OUTPUTS
                             Set to 1 to keep APK output names unversioned.
  PYTHON_BIN                 Python executable for the APKPure downloader. Defaults to python.
  KEYSTORE_FILE              Optional signing keystore path.
  MORPHE_EXTRA_ARGS_JSON     Optional JSON array of extra patch args.`);
}

function downloadApkmirrorVariant(app, { outputDir, requestedLabel, type, arch, dpi, outFile, fallbackArch }) {
  console.log(`Downloading APKMirror ${app.label} ${requestedLabel} (${type}, ${arch}/${dpi})`);
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
    ...(app.apkmirrorSlug ? ["--slug", app.apkmirrorSlug] : []),
    "--out-dir",
    outputDir,
    "--version",
    requestedLabel,
    "--arch",
    arch,
    "--dpi",
    dpi,
    "--type",
    type,
    "--out-file",
    outFile,
    ...(fallbackArch ? ["--fallback-arch", fallbackArch] : []),
  ]);

  return metadata;
}

function uptodownDownloadPage(app) {
  const slug = app.uptodownSlug || (app.baseId || app.id);
  return `https://${slug}.en.uptodown.com/android/download`;
}

function uptodownVersionsPage(app) {
  const slug = app.uptodownSlug || (app.baseId || app.id);
  return `https://${slug}.en.uptodown.com/android/versions`;
}

async function uptodownExactDownloadPage(app, selectedVersion) {
  const versionsPage = uptodownVersionsPage(app);
  const page = await fetchText(versionsPage, uptodownHeaders());
  const versions = parseUptodownVersionsPage(app, versionsPage, page);
  const selected = versions.find((item) => item.version === selectedVersion);
  if (!selected) {
    const sample = versions.slice(0, 20).map((item) => item.version).filter(Boolean).join(", ");
    throw new Error(`${app.label}: Uptodown version ${selectedVersion} was not found. Available sample: ${sample || "none"}.`);
  }
  return selected.downloadPage;
}

function parseUptodownVersionsPage(app, sourcePage, page) {
  const versions = [];
  const rows = [...page.matchAll(/<div\b(?=[^>]*\bdata-version-id=)[^>]*>[\s\S]*?<\/div>/gi)];

  for (const row of rows) {
    const block = row[0];
    const version = firstMatch(block, /<span[^>]+class=["'][^"']*\bversion\b[^"']*["'][^>]*>\s*([^<]+)/i);
    const versionId = htmlAttribute(block, "data-version-id");
    const baseUrl = htmlAttribute(block, "data-url");
    const extraUrl = htmlAttribute(block, "data-extra-url") || "download";
    if (!version || !versionId || !baseUrl) continue;

    versions.push({
      version,
      versionId,
      downloadPage: `${baseUrl.replace(/\/$/, "")}/${extraUrl.replace(/^\/|\/$/g, "")}/${versionId}`,
    });
  }

  if (!versions.length) {
    throw new Error(`${app.label}: Uptodown versions were not found at ${sourcePage}.`);
  }

  return versions;
}

function parseUptodownDownloadPage(app, sourcePage, page) {
  const button = page.match(/<button[^>]+id=["']detail-download-button["'][\s\S]*?>/i)?.[0] || "";
  const token = htmlAttribute(button, "data-url");
  if (!token) {
    throw new Error(`${app.label}: Uptodown download button was not found at ${sourcePage}.`);
  }

  return {
    version: firstMatch(page, /"softwareVersion"\s*:\s*"([^"]+)"/i)
      || firstMatch(page, /<title>\s*Download\s+.+?\s+(\d+(?:\.\d+)+)\s+for Android/i),
    versionCode: htmlAttribute(button, "data-download-version"),
    directUrl: `https://dw.uptodown.com/dwn/${token}`,
    size: firstMatch(button, /<span class=["']size["']>\s*([^<]+)/i) || firstMatch(page, /<span class=["']size["']>\s*([^<]+)/i),
  };
}

function divxlandDownloadPage(app) {
  const slug = app.divxlandSlug || (app.baseId || app.id);
  return `https://${slug}.en.divxland.org/download/`;
}

function parseDivxlandDownloadPage(app, sourcePage, page) {
  const version = firstMatch(page, /"softwareVersion"\s*:\s*"([^"]+)"/i)
    || firstMatch(page, /Download\s+.+?\s+(\d+(?:\.\d+)+)\s+latest version/i);
  const size = firstMatch(page, /"fileSize"\s*:\s*"([^"]+)"/i)
    || firstMatch(page, /<span[^>]+class=["'][^"']*download-size[^"']*["'][^>]*>\s*([^<]+)/i);
  const downloadHref = htmlDecode(firstMatch(page, /<a[^>]+id=["']downloadBtn["'][^>]+href=["']([^"']+)["']/i)
    || firstMatch(page, /<a[^>]+href=["']([^"']*\/download\/\d+\/)["'][^>]*>\s*[\s\S]*?Download APK/i)
    || "/download/0/");
  const downloadPage = resolveUrl(sourcePage, downloadHref);
  if (!downloadPage) {
    throw new Error(`${app.label}: DivxLand download link was not found at ${sourcePage}.`);
  }

  const downloadHtml = page.includes("const postId")
    ? page
    : null;
  return parseDivxlandIntermediatePage(app, sourcePage, downloadPage, version, size, downloadHtml);
}

function parseDivxlandIntermediatePage(app, sourcePage, downloadPage, version, size, knownHtml = null) {
  const html = knownHtml || "";
  const page = html || null;
  if (page) {
    const postId = firstMatch(page, /const\s+postId\s*=\s*(\d+)/);
    const idx = firstMatch(page, /const\s+idx\s*=\s*(\d+)/) || firstMatch(downloadPage, /\/download\/(\d+)\//) || "0";
    if (postId) {
      return {
        version,
        size,
        downloadPage,
        keyUrl: resolveUrl(downloadPage, `/download/${idx}/key/`),
        postId: Number(postId),
      };
    }
  }

  return {
    version,
    size,
    downloadPage,
    keyUrl: "",
    postId: 0,
    needsIntermediateFetch: true,
    sourcePage,
  };
}

async function fetchText(url, headers = {}) {
  const response = await fetchWithRetry(url, { headers });
  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }
  return response.text();
}

function firstMatch(value, pattern) {
  return value?.match(pattern)?.[1]?.trim() || "";
}

function htmlAttribute(tag, name) {
  return htmlDecode(firstMatch(tag || "", new RegExp(`${name}=["']([^"']+)["']`, "i")));
}

function htmlDecode(value = "") {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function resolveUrl(base, value) {
  if (!value) return "";
  return new URL(value, base).toString();
}

function extensionFromDownload(url, fallback = "apk") {
  try {
    const extension = extname(new URL(url).pathname).toLowerCase();
    if ([".apk", ".xapk", ".apkm", ".apks"].includes(extension)) return extension;
  } catch {}
  return `.${fallback.replace(/^\./, "")}`;
}

function uptodownHeaders(extra = {}) {
  return {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent": "Mozilla/5.0 morph-youtube-builder",
    ...extra,
  };
}

function divxlandHeaders(referer = "", extra = {}) {
  return {
    "Accept": "text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent": "Mozilla/5.0 morph-youtube-builder",
    ...(referer ? { Referer: referer } : {}),
    ...extra,
  };
}

function shouldRetryApkmirrorUniversalApk(app, apkmirrorType, error) {
  return Boolean(app.artifactAbi)
    && String(apkmirrorType).toLowerCase() === "bundle"
    && splitList(app.apkmirrorFallbackArch).includes("universal")
    && /Could not find APKMirror BUNDLE variant/i.test(error?.message || "");
}

function existingApkmirrorInputMatches(app, existing) {
  const requestedType = (app.apkmirrorType || "apk").toUpperCase();
  const requestedArches = splitList(app.apkmirrorArch);
  const requestedDpi = app.apkmirrorDpi || "";
  const existingArches = splitList(existing?.arch);

  const existingType = String(existing?.fileType || "").toUpperCase();
  if (existingType && requestedType === "BUNDLE" && !["BUNDLE", "APKM"].includes(existingType)) {
    return false;
  }
  if (existingType && requestedType !== "BUNDLE" && existingType !== requestedType) {
    return false;
  }
  if (requestedDpi && requestedDpi !== "any" && requestedDpi !== "*" && existing?.dpi && existing.dpi !== requestedDpi) {
    return false;
  }
  if (!requestedArches.length || requestedArches.includes("all") || requestedArches.includes("full")) {
    return true;
  }
  if (requestedArches.length === 1 && !["universal", "noarch"].includes(requestedArches[0])) {
    return existingArches.length === 1 && existingArches[0] === requestedArches[0];
  }
  return requestedArches.every((arch) => existingArches.includes(arch))
    || existingArches.some((arch) => ["universal", "noarch"].includes(arch));
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

function splitList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
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

function envPathValue(value) {
  return resolveMaybeRoot(value);
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
  if (typeof patch === "string") return patch;
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

function formatFailedPatchList(entries, limit = 5) {
  const shown = entries.slice(0, limit).map(formatFailedPatch);
  const remaining = entries.length - shown.length;
  return remaining > 0
    ? `${shown.join("; ")}; +${remaining} more`
    : shown.join("; ");
}

function firstReasonLine(reason) {
  return String(reason || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function commandOutputTail(output, maxLines = 40) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .slice(-maxLines)
    .join("\n");
}

function commandOutputSummary(output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(info|debug|trace)\b/i.test(line));
  return lines.at(-1) || "";
}

function compareVersions(a, b) {
  const left = versionSortParts(a);
  const right = versionSortParts(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "number") return leftPart - rightPart;
    return String(leftPart).localeCompare(String(rightPart));
  }

  return 0;
}

function versionsMatch(v1, v2) {
  if (!v1 || !v2) return false;
  const s1 = String(v1).trim().toLowerCase();
  const s2 = String(v2).trim().toLowerCase();
  if (s1 === s2) return true;

  const clean = (v) => {
    return v
      .replace(/[-_]/g, ".")
      .replace(/\b(release|stable|beta|alpha|ripped|prod|final|android)\b/g, "")
      .replace(/\.+/g, ".")
      .replace(/^\.|\.$/g, "");
  };

  const c1 = clean(s1);
  const c2 = clean(s2);
  if (c1 === c2) return true;

  const parts1 = c1.split(".").filter((x) => /^\d+$/.test(x));
  const parts2 = c2.split(".").filter((x) => /^\d+$/.test(x));
  if (parts1.length && parts2.length) {
    const minLen = Math.min(parts1.length, parts2.length);
    if (minLen >= 3 && parts1.slice(0, 3).join(".") === parts2.slice(0, 3).join(".")) {
      return true;
    }
    if (minLen >= 2 && parts1.slice(0, minLen).join(".") === parts2.slice(0, minLen).join(".")) {
      return true;
    }
  }
  return false;
}

function versionSortParts(version) {
  return String(version)
    .split(/(\d+)/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

function safeVersionForFile(version) {
  return String(version || "unknown")
    .trim()
    .replace(/[^A-Za-z0-9._+-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
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
