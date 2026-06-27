#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "build";
const args = process.argv.slice(3);
const isMain = process.argv[1] && (
  resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
);

const supportedTargets = new Set([
  "adguard",
  "alltrails",
  "avocards",
  "busuu",
  "cake",
  "camscanner",
  "daily-pocket",
  "duolingo",
  "eggbun",
  "fotmob",
  "github",
  "hellochinese",
  "ibispaint-x",
  "icon-packer",
  "lingory",
  "lyfta",
  "macrofactor",
  "macrofactor-workouts",
  "meme-generator",
  "merriam-webster",
  "mimo",
  "mirinae",
  "myexpenses",
  "myfitnesspal",
  "niagara-launcher",
  "nomone-desktop",
  "nova-launcher",
  "pandora",
  "podcast-addict",
  "prime-video",
  "proton-vpn",
  "pydroid3",
  "rp-hypertrophy",
  "showly",
  "sleep-as-android",
  "smart-launcher",
  "snorelab",
  "sofascore",
  "solid-explorer",
  "soundcloud",
  "teuida",
  "ttmik-stories",
  "ventusky",
  "wallcraft",
  "windy",
  "world-map-quiz",
  "wps-office",
  "xodo",
  "xrecorder",
]);

import { externalPatchAppConfigs } from "./morphe.mjs";

export const appConfigs = externalPatchAppConfigs([
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
]);

if (isMain) {
  const buildTargets = env("BUILD_TARGETS") || "proton-vpn";

  validateTargets(buildTargets);

  const childEnv = {
    ...process.env,
    MORPHE_BUILDER: "hoodles",
    BUILD_TARGETS: buildTargets,
    APK_SOURCE: env("APK_SOURCE") || "apkmirror,apkpure",
    APK_VERSION_SOURCE: "recommended",
    APK_LATEST_COMPATIBLE_ONLY: "",
    APK_FALLBACK_TO_LATEST: "false",
    APKMIRROR_ARCH: env("APKMIRROR_ARCH") || "arm64-v8a",
    MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI: env("MORPHE_ALLOW_UNIVERSAL_APKS_FOR_ABI") || "0",
    MORPHE_PATCHES_PROVIDER: "github",
    MORPHE_PATCHES_REPO: env("HOODLES_PATCHES_REPO") || "hoo-dles/morphe-patches",
    MORPHE_PATCHES_VERSION: env("HOODLES_PATCHES_VERSION") || env("MORPHE_PATCHES_VERSION") || "stable",
    MORPHE_CREATE_DEFAULT_OPTIONS: env("MORPHE_CREATE_DEFAULT_OPTIONS") || "1",
    MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS: env("MORPHE_DISABLE_PACKAGE_RENAME_OPTIONS") || "1",
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
    console.error(`hoodles-builder failed to start: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function defaultPatchArgs() {
  const args = [];
  if (truthy(env("CONTINUE_ON_ERROR") || "true")) args.push("--continue-on-error");
  return args;
}

function validateTargets(value) {
  if (!["build", "download", "options", "release-check", "release-notes"].includes(command)) return;

  const requested = value.split(",").map((target) => target.trim().toLowerCase()).filter(Boolean);
  const unknown = requested.filter((target) => !supportedTargets.has(target));
  if (unknown.length) {
    console.error(`Unsupported Hoodles target(s): ${unknown.join(", ")}`);
    console.error(`Supported Hoodles targets: ${[...supportedTargets].join(", ")}`);
    process.exit(1);
  }
}

function env(name) {
  return process.env[name] || "";
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}
