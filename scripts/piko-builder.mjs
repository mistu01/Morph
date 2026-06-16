#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, createWriteStream } from "node:fs";
import { basename, dirname, join, resolve, extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
    apkpureName: "Instagram",
    apkpureSlug: "instagram",
    apkpurePage: "https://apkpure.com/instagram/com.instagram.android",
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
    gofileUrl: env("TWITTER_GOFILE_URL") || env("TWITTER_APK_URL"),
    gofilePassword: env("TWITTER_GOFILE_PASSWORD") || env("GOFILE_PASSWORD"),
    gofileToken: env("TWITTER_GOFILE_TOKEN") || env("GOFILE_TOKEN"),
    input: fromRoot("input/twitter.apkm"),
    output: fromRoot("output/twitter-patched.apk"),
    result: fromRoot("output/twitter-result.json"),
    apkpureName: "X",
    apkpureSlug: "x",
    apkpurePage: "https://apkpure.com/x/com.twitter.android",
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

async function downloadFile(url, destination, extraHeaders = {}) {
  const headers = {
    "User-Agent": "piko-builder",
    ...extraHeaders,
  };
  const token = env("GITHUB_TOKEN");
  if (token && !token.includes("dummy") && url.includes("github.com")) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  return { url: response.url, headers: response.headers };
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
  const patchesMetaDest = join(paths.tools, "piko-patches.json");
  const patchesListDest = join(paths.tools, "patches-list.json");

  console.log(`Downloading morphe-cli ${cliRelease.tag_name} -> ${cliDest}`);
  await downloadFile(cliAsset.browser_download_url, cliDest);

  console.log(`Downloading piko-patches ${patchesRelease.tag_name} -> ${patchesDest}`);
  await downloadFile(patchesAsset.browser_download_url, patchesDest);
  writeFileSync(patchesMetaDest, JSON.stringify({
    repo: patchesRepo,
    tag: patchesRelease.tag_name,
    url: patchesRelease.html_url || `https://github.com/${patchesRepo}/releases/tag/${patchesRelease.tag_name}`,
    asset: patchesAsset.name,
    downloadedAt: new Date().toISOString(),
  }, null, 2));

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

    // 2. Download APK/APKM from a custom Gofile link, APKMirror, or APKPure fallback.
    let downloadSucceeded = false;
    let actualInputPath = app.input;

    if (app.gofileUrl) {
      actualInputPath = await downloadGofileInput(app);
      downloadSucceeded = true;
      console.log(`Using custom Gofile input for ${app.label}: ${actualInputPath}`);
    }

    if (!downloadSucceeded) {
      console.log(`Downloading ${app.label} v${version} (${app.apkmirrorArch}) from APKMirror...`);
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
      if (downloadProc.status === 0 && existsSync(app.input)) {
        downloadSucceeded = true;
      } else {
        console.warn(`APKMirror download failed for ${app.label} v${version}. Trying APKPure fallback...`);
        const apkpureArgs = [
          join(root, "scripts/apkpure_download.py"),
          "--app-name", app.apkpureName || app.label,
          "--package-name", app.packageName,
          "--source-page", app.apkpurePage || `https://apkpure.com/${app.id}/${app.packageName}`,
          "--out-dir", paths.input,
          "--version", version,
          "--arch", app.apkmirrorArch || "arm64-v8a",
        ];

        console.log(`Running APKPure downloader: python ${apkpureArgs.join(" ")}`);
        const apkpureProc = spawnSync("python", apkpureArgs, { stdio: ["inherit", "pipe", "inherit"] });
        if (apkpureProc.status === 0) {
          try {
            const stdoutStr = apkpureProc.stdout.toString().trim();
            const jsonMatch = stdoutStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const metadata = JSON.parse(jsonMatch[0]);
              if (metadata.path && existsSync(metadata.path)) {
                const ext = extname(metadata.path).toLowerCase() || ".apk";
                const targetPath = app.input.slice(0, app.input.length - extname(app.input).length) + ext;
                if (existsSync(targetPath)) {
                  rmSync(targetPath, { force: true });
                }
                renameSync(metadata.path, targetPath);
                actualInputPath = targetPath;
                downloadSucceeded = true;
                console.log(`Successfully downloaded ${app.label} v${metadata.version} from APKPure: ${actualInputPath}`);
              } else {
                console.error(`APKPure download path ${metadata.path} does not exist.`);
              }
            } else {
              console.error(`APKPure stdout did not contain JSON: ${stdoutStr}`);
            }
          } catch (err) {
            console.error(`Error parsing APKPure download output: ${err.message}`);
          }
        } else {
          console.error(`APKPure downloader process failed with exit code ${apkpureProc.status}`);
        }
      }
    }

    if (!downloadSucceeded) {
      throw new Error(`Failed to download ${app.label} APK/APKM from both APKMirror and APKPure.`);
    }

    console.log(`Using input file: ${actualInputPath}`);

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
        "--keystore-entry-alias", keystoreAlias,
        "--keystore-entry-password", keystoreEntryPassword || keystorePassword
      );
    }

    patchArgs.push(actualInputPath);

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
    }

    await renameVersionedBuildOutput(app, version);
    if (existsSync(app.output)) {
      console.log(`Patched APK output: ${app.output}`);
    }
  }

  // 4. Generate and write build summary
  console.log(`\n==================================================`);
  console.log(`Piko Build Run Summary`);
  console.log(`==================================================`);

  let summaryMd = `### Patching Results\n\n`;

  for (const targetId of targets) {
    const app = appConfigs[targetId];
    if (!app) continue;

    summaryMd += `#### ${app.label}\n`;
    const success = existsSync(app.output);
    if (success) {
      console.log(`- ${app.label}: SUCCESS`);
      summaryMd += `- **Status**: Success\n`;
    } else {
      console.log(`- ${app.label}: FAILED`);
      summaryMd += `- **Status**: Failed (Patched APK not generated)\n`;
    }

    if (existsSync(app.result)) {
      try {
        const resultJson = JSON.parse(readFileSync(app.result, "utf8"));
        const appliedCount = Array.isArray(resultJson.appliedPatches) ? resultJson.appliedPatches.length : 0;
        const failedCount = Array.isArray(resultJson.failedPatches) ? resultJson.failedPatches.length : 0;
        console.log(`  Stats: ${appliedCount} patches applied, ${failedCount} patches failed.`);
        summaryMd += `- **Patches Applied**: ${appliedCount}\n`;
        summaryMd += `- **Patches Failed**: ${failedCount}\n`;

        if (failedCount > 0) {
          summaryMd += `  <details><summary>Click to view failed patches</summary>\n\n  \`\`\`\n`;
          for (const entry of resultJson.failedPatches) {
            const name = entry?.patch?.name || entry?.patch || "Unknown";
            const reason = entry?.reason || "No reason provided";
            summaryMd += `  - ${name}: ${reason.split('\n')[0]}\n`;
          }
          summaryMd += `  \`\`\`\n  </details>\n`;
        }
      } catch (err) {
        console.error(`  Error parsing result file: ${err.message}`);
        summaryMd += `- **Error**: Failed to parse patch results JSON: ${err.message}\n`;
      }
    } else {
      console.log(`  Stats: No results file found.`);
      summaryMd += `- **Error**: Result JSON not found\n`;
    }
    summaryMd += `\n`;
  }

  writeFileSync(fromRoot("output/build-summary.md"), summaryMd);
  console.log(`\nWritten build summary to output/build-summary.md`);
}

async function renameVersionedBuildOutput(app, version) {
  if (!existsSync(app.output)) return;

  const outputVersion = buildResultVersion(app) || version || "unknown";
  const safeVersion = safeNamePart(outputVersion);
  const safeArch = safeNamePart(displayArch(app.apkmirrorArch || env("APKMIRROR_ARCH") || "arm64-v8a"));
  const destination = join(dirname(app.output), `${app.id}-${safeVersion}-${safeArch}-patched.apk`);

  if (resolve(destination) !== resolve(app.output)) {
    rmSync(destination, { force: true });
    renameSync(app.output, destination);
    app.output = destination;
    console.log(`${app.label}: renamed APK output to ${app.output}`);
  }

  updateBuildResultOutput(app, outputVersion, displayArch(app.apkmirrorArch || env("APKMIRROR_ARCH") || "arm64-v8a"));
}

async function downloadGofileInput(app) {
  const selected = await resolveGofileDownload(app);
  const extension = packageExtension(selected.fileName || selected.url) || packageExtension(app.input) || ".apk";
  const destination = replaceExtension(app.input, extension);

  console.log(`Downloading custom ${app.label} input from Gofile (${selected.fileName || "direct file"})...`);
  rmSync(destination, { force: true });
  const downloaded = await downloadFile(selected.url, destination, gofileDownloadHeaders(selected.token));
  const contentType = downloaded.headers.get("content-type") || "";
  if (/text\/html/i.test(contentType)) {
    rmSync(destination, { force: true });
    throw new Error(
      `${app.label}: the Gofile link returned an HTML page instead of an APK/APKM file. ` +
      `Use a public share link like https://gofile.io/d/... or a direct file download link.`
    );
  }

  app.input = destination;
  return destination;
}

async function resolveGofileDownload(app) {
  const contentId = gofileContentId(app.gofileUrl);
  if (!contentId) {
    console.log(`Treating ${app.label} Gofile input as a direct download URL.`);
    return { url: app.gofileUrl, fileName: basenameFromUrl(app.gofileUrl), token: app.gofileToken };
  }

  console.log(`Resolving ${app.label} Gofile share link ${redactGofileUrl(app.gofileUrl)}...`);
  const token = app.gofileToken || await createGofileGuestToken();
  const passwordHash = app.gofilePassword
    ? createHash("sha256").update(app.gofilePassword).digest("hex")
    : "";
  const params = new URLSearchParams({
    contentFilter: "",
    page: "1",
    pageSize: "1000",
    sortField: "name",
    sortDirection: "1",
    ...(passwordHash ? { password: passwordHash } : {}),
  });
  const response = await gofileJson(`https://api.gofile.io/contents/${encodeURIComponent(contentId)}?${params}`, {
    token,
  });
  const file = findGofilePackage(response.data);
  if (!file?.link) {
    const names = gofilePackageCandidateNames(response.data);
    throw new Error(
      `${app.label}: no APK/APKM/XAPK/APKS file was found in the Gofile link.` +
      (names.length ? ` Files seen: ${names.join(", ")}` : "")
    );
  }

  return {
    url: file.link,
    fileName: file.name || basenameFromUrl(file.link),
    token,
  };
}

async function createGofileGuestToken() {
  const response = await gofileJson("https://api.gofile.io/accounts", { method: "POST" });
  const token = response?.data?.token;
  if (!token) {
    throw new Error("Gofile guest account creation did not return an access token.");
  }
  return token;
}

async function gofileJson(url, { method = "GET", token = "" } = {}) {
  const response = await fetch(url, {
    method,
    headers: gofileApiHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Gofile request failed (${response.status}) for ${url}`);
  }

  const data = await response.json();
  if (data.status !== "ok") {
    throw new Error(`Gofile request failed: ${data.status || "unknown error"}`);
  }
  return data;
}

function gofileApiHeaders(token = "") {
  const userAgent = "Mozilla/5.0 piko-builder";
  return {
    Accept: "application/json,*/*",
    "Accept-Encoding": "gzip",
    "User-Agent": userAgent,
    Origin: "https://gofile.io",
    Referer: "https://gofile.io/",
    "X-BL": "en-US",
    "X-Website-Token": gofileWebsiteToken(userAgent, token),
    ...(token ? {
      Authorization: `Bearer ${token}`,
      Cookie: `accountToken=${token}`,
    } : {}),
  };
}

function gofileDownloadHeaders(token = "") {
  const userAgent = "Mozilla/5.0 piko-builder";
  return {
    Accept: "application/vnd.android.package-archive,application/octet-stream,*/*",
    "User-Agent": userAgent,
    Origin: "https://gofile.io",
    Referer: "https://gofile.io/",
    ...(token ? {
      Authorization: `Bearer ${token}`,
      Cookie: `accountToken=${token}`,
      "X-BL": "en-US",
      "X-Website-Token": gofileWebsiteToken(userAgent, token),
    } : {}),
  };
}

function gofileWebsiteToken(userAgent, token) {
  const timeSlot = Math.floor(Date.now() / 1000 / 14400);
  return createHash("sha256")
    .update(`${userAgent}::en-US::${token}::${timeSlot}::5d4f7g8sd45fsd`)
    .digest("hex");
}

function gofileContentId(url) {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)gofile\.(io|co)$/i.test(parsed.hostname)) return "";
    const parts = parsed.pathname.split("/").filter(Boolean);
    const marker = parts.findIndex((part) => ["d", "f", "download"].includes(part.toLowerCase()));
    if (marker >= 0 && parts[marker + 1]) return parts[marker + 1];

    for (const key of ["c", "file", "id", "contentId", "contentid"]) {
      const value = parsed.searchParams.get(key);
      if (value) return value;
    }

    if (parts.length === 1 && /^[A-Za-z0-9_-]{6,}$/.test(parts[0])) {
      return parts[0];
    }

    return "";
  } catch {
    return "";
  }
}

function findGofilePackage(rootContent) {
  const candidates = [];
  const visit = (content) => {
    if (!content) return;
    if (content.type === "folder") {
      const children = Array.isArray(content.children) ? content.children : Object.values(content.children || {});
      for (const child of children) visit(child);
      return;
    }

    const extension = packageExtension(content.name || content.link || "");
    if (extension) candidates.push(content);
  };

  visit(rootContent);
  return candidates.sort((a, b) => packagePriority(a) - packagePriority(b))[0];
}

function packagePriority(content) {
  const name = String(content.name || content.link || "").toLowerCase();
  const extension = packageExtension(name);
  const extensionRank = { ".apkm": 0, ".xapk": 1, ".apks": 2, ".apk": 3 }[extension] ?? 9;
  const nameRank = /\btwitter\b|\bx\b/.test(name) ? 0 : 1;
  return nameRank * 10 + extensionRank;
}

function gofilePackageCandidateNames(rootContent) {
  const names = [];
  const visit = (content) => {
    if (!content) return;
    if (content.type === "folder") {
      const children = Array.isArray(content.children) ? content.children : Object.values(content.children || {});
      for (const child of children) visit(child);
      return;
    }

    if (content.name) names.push(content.name);
  };

  visit(rootContent);
  return names.slice(0, 10);
}

function redactGofileUrl(url) {
  const id = gofileContentId(url);
  return id ? `https://gofile.io/d/${id.slice(0, 4)}...` : "provided URL";
}

function updateBuildResultOutput(app, version, arch) {
  if (!existsSync(app.result)) return;

  try {
    const result = JSON.parse(readFileSync(app.result, "utf8"));
    writeFileSync(app.result, JSON.stringify({
      ...result,
      packageVersion: result.packageVersion || version,
      artifactArch: arch,
      output: app.output,
      artifactName: basename(app.output),
    }, null, 2));
  } catch (error) {
    console.warn(`Could not update result metadata for ${app.label}: ${error.message}`);
  }
}

function displayArch(arch) {
  return arch === "armeabi-v7a" ? "arm-v7a" : arch;
}

function buildResultVersion(app) {
  if (!existsSync(app.result)) return "";

  try {
    const result = JSON.parse(readFileSync(app.result, "utf8"));
    return result.packageVersion || "";
  } catch {
    return "";
  }
}

function replaceExtension(file, extension) {
  return file.slice(0, file.length - extname(file).length) + extension;
}

function packageExtension(value) {
  try {
    const parsed = new URL(value);
    return packageExtension(parsed.pathname);
  } catch {}

  const extension = extname(String(value || "")).toLowerCase();
  return [".apk", ".apkm", ".xapk", ".apks"].includes(extension) ? extension : "";
}

function basenameFromUrl(url) {
  try {
    return basename(new URL(url).pathname);
  } catch {
    return basename(String(url || ""));
  }
}

function safeNamePart(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}
