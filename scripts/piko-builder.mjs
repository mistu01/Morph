#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const env = (name) => process.env[name] || "";
const fromRoot = (...parts) => join(root, ...parts);

const paths = {
  tools: fromRoot(".cache/tools"),
  tmp: fromRoot(".cache/tmp"),
  input: fromRoot("input"),
  output: fromRoot("output"),
};

// Ensure directories exist
for (const dir of Object.values(paths)) {
  mkdirSync(dir, { recursive: true });
}

// App configurations
const appConfigs = {
  instagram: {
    id: "instagram",
    label: "Instagram",
    packageName: "com.instagram.android",
    apkmirrorOrg: "instagram",
    apkmirrorRepo: "instagram-instagram",
    apkmirrorType: "bundle",
    apkmirrorArch: env("INSTAGRAM_APKMIRROR_ARCH") || env("APKMIRROR_ARCH") || "arm64-v8a",
    apkmirrorFallbackArch: "universal",
    apkmirrorDpi: "nodpi",
    requestedVersion: env("INSTAGRAM_APK_VERSION"),
    input: fromRoot("input/instagram.apkm"),
    output: fromRoot("output/instagram-patched.apk"),
    result: fromRoot("output/instagram-result.json"),
  },
  twitter: {
    id: "twitter",
    label: "X (Twitter)",
    packageName: "com.twitter.android",
    apkmirrorOrg: "x-corp",
    apkmirrorRepo: "twitter",
    apkmirrorSlug: "x",
    apkmirrorType: "bundle",
    apkmirrorArch: env("TWITTER_APKMIRROR_ARCH") || env("APKMIRROR_ARCH") || "arm64-v8a",
    apkmirrorFallbackArch: "universal",
    apkmirrorDpi: "120-640dpi",
    requestedVersion: env("TWITTER_APK_VERSION"),
    input: fromRoot("input/twitter.apkm"),
    output: fromRoot("output/twitter-patched.apk"),
    result: fromRoot("output/twitter-result.json"),
  },
};

const cliRepo = "MorpheApp/morphe-cli";
const patchesRepo = "crimera/piko";

main().catch((error) => {
  console.error(`\nBuild failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  const command = process.argv[2] || "build";

  switch (command) {
    case "tools":
      await downloadTools();
      break;
    case "build":
      await build();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

async function githubJson(url) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "piko-builder",
  };
  const token = env("GITHUB_TOKEN");
  if (token && !token.includes("dummy")) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function downloadFile(url, destination) {
  const headers = {
    "User-Agent": "piko-builder",
  };
  const token = env("GITHUB_TOKEN");
  if (token && !token.includes("dummy") && url.includes("github.com")) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const fileStream = import("node:fs").then((fs) => fs.createWriteStream(destination));
  const stream = response.body;
  
  // Node fetch returns a ReadableStream. We convert it to a Buffer and write it.
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  writeFileSync(destination, buffer);
}

async function getLatestReleaseTag(repo) {
  const release = await githubJson(`https://api.github.com/repos/${repo}/releases/latest`);
  return release.tag_name;
}

async function getReleaseByTag(repo, tag) {
  if (tag === "latest") {
    return githubJson(`https://api.github.com/repos/${repo}/releases/latest`);
  }
  if (tag === "dev") {
    const releases = await githubJson(`https://api.github.com/repos/${repo}/releases?per_page=100`);
    const devRelease = releases.find((r) => !r.draft && r.prerelease);
    if (!devRelease) {
      throw new Error(`No prerelease found for ${repo}`);
    }
    return devRelease;
  }
  return githubJson(`https://api.github.com/repos/${repo}/releases/tags/${tag}`);
}

async function downloadTools() {
  console.log("==> Downloading Morphe tools...");
  const cliTag = env("MORPHE_CLI_VERSION") || "latest";
  const patchesTag = env("MORPHE_PATCHES_VERSION") || "dev";

  const cliRelease = await getReleaseByTag(cliRepo, cliTag);
  const patchesRelease = await getReleaseByTag(patchesRepo, patchesTag);

  const cliAsset = cliRelease.assets.find((a) => a.name.startsWith("morphe-cli-") && a.name.endsWith("-all.jar"));
  if (!cliAsset) {
    throw new Error(`No matching morphe-cli asset found in release ${cliRelease.tag_name}`);
  }

  const patchesAsset = patchesRelease.assets.find((a) => a.name.startsWith("patches-") && a.name.endsWith(".mpp"));
  if (!patchesAsset) {
    throw new Error(`No patches asset (.mpp) found in release ${patchesRelease.tag_name}`);
  }

  const cliDest = join(paths.tools, "morphe-cli.jar");
  const patchesDest = join(paths.tools, "piko-patches.mpp");
  const patchesListDest = join(paths.tools, "patches-list.json");

  console.log(`Downloading morphe-cli ${cliRelease.tag_name} -> ${cliDest}`);
  await downloadFile(cliAsset.browser_download_url, cliDest);

  console.log(`Downloading piko-patches ${patchesRelease.tag_name} -> ${patchesDest}`);
  await downloadFile(patchesAsset.browser_download_url, patchesDest);

  console.log("Downloading patches-list.json...");
  const patchesListUrl = `https://raw.githubusercontent.com/${patchesRepo}/${patchesRelease.tag_name}/patches-list.json`;
  await downloadFile(patchesListUrl, patchesListDest);

  console.log("Tools downloaded successfully.");
  return {
    cli: cliDest,
    patches: patchesDest,
    patchesList: patchesListDest,
    patchesTag: patchesRelease.tag_name,
  };
}

function resolveRecommendedVersion(patchesListPath, packageName) {
  try {
    const list = JSON.parse(readFileSync(patchesListPath, "utf8"));
    const versions = new Set();
    for (const patch of list.patches || []) {
      const compat = patch.compatiblePackages || [];
      const entry = Array.isArray(compat)
        ? compat.find((e) => e.packageName === packageName)
        : compat[packageName];
      if (entry && entry.targets) {
        for (const target of entry.targets) {
          if (target.version) {
            versions.add(target.version);
          }
        }
      }
    }
    return Array.from(versions).sort().reverse()[0] || "";
  } catch (error) {
    console.warn(`Could not resolve recommended version from patches-list: ${error.message}`);
    return "";
  }
}

async function build() {
  const tools = await downloadTools();

  const targets = (env("BUILD_TARGETS") || "twitter,instagram")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  for (const targetId of targets) {
    const app = appConfigs[targetId];
    if (!app) {
      console.warn(`Warning: unknown target: ${targetId}`);
      continue;
    }

    console.log(`\n==================================================`);
    console.log(`Building ${app.label}`);
    console.log(`==================================================`);

    // 1. Resolve APK version
    let version = app.requestedVersion;
    if (!version) {
      version = resolveRecommendedVersion(tools.patchesList, app.packageName);
      console.log(`Resolved recommended version for ${app.label}: ${version}`);
    } else {
      console.log(`Using user-requested version: ${version}`);
    }

    if (!version) {
      throw new Error(`Could not resolve version for ${app.label}. Please specify ${app.id.toUpperCase()}_APK_VERSION.`);
    }

    // 2. Download APK/APKM from APKMirror
    console.log(`Downloading ${app.label} v${version} (${app.apkmirrorArch})...`);
    const downloadArgs = [
      join(root, "scripts/apkmirror_download.py"),
      "--app-name", app.label,
      "--package-name", app.packageName,
      "--org", app.apkmirrorOrg,
      "--repo", app.apkmirrorRepo,
      "--version", version,
      "--arch", app.apkmirrorArch,
      "--fallback-arch", app.apkmirrorFallbackArch,
      "--dpi", app.apkmirrorDpi,
      "--type", app.apkmirrorType,
      "--out-dir", paths.input,
      "--out-file", basename(app.input),
    ];

    if (app.apkmirrorSlug) {
      downloadArgs.push("--slug", app.apkmirrorSlug);
    }

    const downloadProc = spawnSync("python", downloadArgs, { stdio: "inherit" });
    if (downloadProc.status !== 0) {
      throw new Error(`Failed to download ${app.label} APK/APKM from APKMirror.`);
    }

    console.log(`APK/APKM downloaded to ${app.input}`);

    // 3. Patch the APK
    const temporaryFilesPath = join(paths.tmp, app.id);
    mkdirSync(temporaryFilesPath, { recursive: true });

    const patchArgs = [
      "-jar", tools.cli,
      "patch",
      "--patches", tools.patches,
      "--out", app.output,
      "--result-file", app.result,
      "--temporary-files-path", temporaryFilesPath,
      "--purge",
      "--force",
    ];

    // Append keystore signing if present
    const keystoreFile = env("KEYSTORE_FILE");
    const keystorePassword = env("KEYSTORE_PASSWORD");
    const keystoreAlias = env("KEYSTORE_ALIAS");
    const keystoreEntryPassword = env("KEYSTORE_ENTRY_PASSWORD");

    if (keystoreFile && existsSync(keystoreFile)) {
      console.log(`Using keystore ${keystoreFile} to sign the APK`);
      patchArgs.push(
        "--keystore", keystoreFile,
        "--keystore-password", keystorePassword,
        "--key-alias", keystoreAlias,
        "--key-password", keystoreEntryPassword || keystorePassword
      );
    }

    patchArgs.push(app.input);

    console.log(`\nRunning Morphe CLI patcher: java ${patchArgs.join(" ")}`);
    const patchProc = spawnSync("java", patchArgs, { stdio: "inherit" });

    if (patchProc.status !== 0) {
      console.error(`Patcher failed for ${app.label}. Check stdout logs above.`);
      // Read and print the result file if it exists
      if (existsSync(app.result)) {
        try {
          const resultJson = JSON.parse(readFileSync(app.result, "utf8"));
          console.error("\nFailed patches detail:");
          console.error(JSON.stringify(resultJson.failedPatches, null, 2));
        } catch {}
      }
      if (env("CONTINUE_ON_ERROR") !== "true") {
        throw new Error(`Patching failed for ${app.label}.`);
      }
    } else {
      console.log(`\nSuccessfully patched ${app.label}!`);
      console.log(`Patched APK output: ${app.output}`);
    }
  }
}
