#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, createWriteStream, statSync } from "node:fs";
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
    googleDriveUrl: env("TWITTER_GOOGLE_DRIVE_URL") || env("TWITTER_GDRIVE_URL"),
    googleDriveFileId: env("TWITTER_GOOGLE_DRIVE_FILE_ID") || env("TWITTER_GDRIVE_FILE_ID"),
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

function resolveConfiguredVersion(app, patchesListPath) {
  if (app.requestedVersion) {
    console.log(`Using user-requested version: ${app.requestedVersion}`);
    return app.requestedVersion;
  }

  const version = resolveRecommendedVersion(patchesListPath, app.packageName);
  console.log(`Resolved recommended version for ${app.label}: ${version}`);
  return version;
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

    const hasCustomGoogleDriveInput = Boolean(app.googleDriveUrl || app.googleDriveFileId);

    // 1. Resolve APK version. Custom Google Drive inputs override this after download.
    let version = "";
    if (hasCustomGoogleDriveInput) {
      if (app.requestedVersion) {
        console.log(`Custom Google Drive input provided for ${app.label}; configured version ${app.requestedVersion} will only be used if package metadata is unavailable.`);
      } else {
        console.log(`Custom Google Drive input provided for ${app.label}; package metadata will determine the version.`);
      }
    } else {
      version = resolveConfiguredVersion(app, tools.patchesList);
    }

    if (!hasCustomGoogleDriveInput && !version) {
      throw new Error(`Could not resolve version for ${app.label}. Please specify ${app.id.toUpperCase()}_APK_VERSION.`);
    }

    // 2. Download APK/APKM from a custom Google Drive link, APKMirror, or APKPure fallback.
    let downloadSucceeded = false;
    let actualInputPath = app.input;

    if (hasCustomGoogleDriveInput) {
      actualInputPath = downloadGoogleDriveInput(app);
      downloadSucceeded = true;
      console.log(`Using custom Google Drive input for ${app.label}: ${actualInputPath}`);
      const inputMetadata = readCustomInputMetadata(app, actualInputPath);
      if (inputMetadata.packageName && inputMetadata.packageName !== app.packageName) {
        throw new Error(`${app.label}: Google Drive input package name is ${inputMetadata.packageName}, expected ${app.packageName}.`);
      }
      if (inputMetadata.version) {
        version = inputMetadata.version;
        console.log(`${app.label}: overriding configured version with Google Drive package version ${version}.`);
      } else {
        version = resolveConfiguredVersion(app, tools.patchesList);
        console.warn(`${app.label}: could not detect a package version from the Google Drive input; using configured version ${version || "unknown"}.`);
      }
    }

    if (!version) {
      throw new Error(`Could not resolve version for ${app.label}. Please specify ${app.id.toUpperCase()}_APK_VERSION or provide package metadata in the custom input.`);
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

function downloadGoogleDriveInput(app) {
  const source = googleDriveSource(app);
  const python = env("PYTHON_BIN") || "python";
  const destination = app.input;
  const args = [
    "-m", "gdown",
    "--fuzzy",
    "--continue",
    "-O", destination,
    source,
  ];

  console.log(`Downloading custom ${app.label} input from Google Drive...`);
  rmSync(destination, { force: true });
  const proc = spawnSync(python, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (proc.stdout?.trim()) {
    console.log(proc.stdout.trim());
  }
  if (proc.stderr?.trim()) {
    console.error(proc.stderr.trim());
  }
  if (proc.status !== 0) {
    throw new Error(`Google Drive download failed for ${app.label}.`);
  }
  if (!existsSync(destination) || statSync(destination).size === 0) {
    throw new Error(`Google Drive download did not create a usable file at ${destination}.`);
  }

  app.input = destination;
  return destination;
}

function googleDriveSource(app) {
  const value = (app.googleDriveUrl || app.googleDriveFileId || "").trim();
  if (!value) {
    throw new Error(`${app.label}: Google Drive source is empty.`);
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (/^[A-Za-z0-9_-]{10,}$/.test(value)) {
    return `https://drive.google.com/uc?id=${encodeURIComponent(value)}`;
  }

  throw new Error(`${app.label}: Google Drive input must be a Drive URL or file ID.`);
}

function readCustomInputMetadata(app, filePath) {
  const python = env("PYTHON_BIN") || "python";
  const script = String.raw`
import json
import struct
import sys
import zipfile
from pathlib import Path

path = Path(sys.argv[1])

def text_value(data, *keys):
    for key in keys:
        value = data.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""

def metadata_from_json(data, source):
    return {
        "source": source,
        "packageName": text_value(data, "pname", "package_name", "packageName", "package"),
        "version": text_value(data, "release_version", "version_name", "versionName", "version"),
        "versionCode": text_value(data, "versioncode", "version_code", "versionCode"),
        "title": text_value(data, "apk_title", "release_title", "name"),
    }

def read_length8(data, offset):
    value = data[offset]
    offset += 1
    if value & 0x80:
        value = ((value & 0x7f) << 8) | data[offset]
        offset += 1
    return value, offset

def read_length16(data, offset):
    value = struct.unpack_from("<H", data, offset)[0]
    offset += 2
    if value & 0x8000:
        value = ((value & 0x7fff) << 16) | struct.unpack_from("<H", data, offset)[0]
        offset += 2
    return value, offset

def parse_string_pool(data, offset):
    chunk_start = offset
    _, header_size, chunk_size = struct.unpack_from("<HHI", data, offset)
    string_count, _, flags, strings_start, _ = struct.unpack_from("<IIIII", data, offset + 8)
    offsets_start = offset + header_size
    is_utf8 = bool(flags & 0x100)
    strings = []

    for index in range(string_count):
        string_offset = struct.unpack_from("<I", data, offsets_start + index * 4)[0]
        cursor = chunk_start + strings_start + string_offset
        if is_utf8:
            _, cursor = read_length8(data, cursor)
            byte_length, cursor = read_length8(data, cursor)
            strings.append(data[cursor:cursor + byte_length].decode("utf-8", "replace"))
        else:
            char_length, cursor = read_length16(data, cursor)
            byte_length = char_length * 2
            strings.append(data[cursor:cursor + byte_length].decode("utf-16le", "replace"))

    return strings, chunk_start + chunk_size

def string_at(strings, index):
    if index == 0xffffffff or index < 0 or index >= len(strings):
        return ""
    return strings[index]

def typed_value(strings, raw_value, data_type, value):
    raw = string_at(strings, raw_value)
    if raw:
        return raw
    if data_type == 0x03:
        return string_at(strings, value)
    if data_type in (0x10, 0x11):
        return str(value)
    if data_type == 0x12:
        return "true" if value else "false"
    return str(value) if value else ""

def parse_binary_manifest(manifest):
    try:
        _, _, file_size = struct.unpack_from("<HHI", manifest, 0)
        offset = 8
        strings = []

        while offset < min(file_size, len(manifest)):
            chunk_type, header_size, chunk_size = struct.unpack_from("<HHI", manifest, offset)
            if chunk_size <= 0:
                break
            if chunk_type == 0x0001:
                strings, offset = parse_string_pool(manifest, offset)
                continue
            if chunk_type == 0x0102:
                element_offset = offset + header_size
                name_index = struct.unpack_from("<I", manifest, element_offset + 4)[0]
                element_name = string_at(strings, name_index)
                if element_name == "manifest":
                    attr_start, attr_size, attr_count = struct.unpack_from("<HHH", manifest, element_offset + 8)
                    attrs = {}
                    attrs_offset = element_offset + attr_start
                    for index in range(attr_count):
                        attr_offset = attrs_offset + index * attr_size
                        attr_name = string_at(strings, struct.unpack_from("<I", manifest, attr_offset + 4)[0])
                        raw_value = struct.unpack_from("<I", manifest, attr_offset + 8)[0]
                        data_type = manifest[attr_offset + 15]
                        value = struct.unpack_from("<I", manifest, attr_offset + 16)[0]
                        attrs[attr_name] = typed_value(strings, raw_value, data_type, value)
                    return {
                        "source": "AndroidManifest.xml",
                        "packageName": attrs.get("package", ""),
                        "version": attrs.get("versionName", ""),
                        "versionCode": attrs.get("versionCode", ""),
                    }
            offset += chunk_size
    except Exception:
        return {}
    return {}

metadata = {}
try:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        preferred = ["info.json", "manifest.json"]
        candidates = []
        for wanted in preferred:
            candidates.extend(name for name in names if name.lower() == wanted)
        candidates.extend(name for name in names if name.lower().endswith(".json") and name not in candidates)

        for name in candidates:
            try:
                data = json.loads(archive.read(name).decode("utf-8"))
            except Exception:
                continue

            candidate = metadata_from_json(data, name)
            if candidate.get("version") or candidate.get("packageName"):
                metadata = {key: value for key, value in candidate.items() if value}
                break
        if not metadata and "AndroidManifest.xml" in names:
            metadata = {key: value for key, value in parse_binary_manifest(archive.read("AndroidManifest.xml")).items() if value}
except zipfile.BadZipFile:
    pass

print(json.dumps(metadata))
`;

  const proc = spawnSync(python, ["-c", script, filePath], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (proc.stderr?.trim()) {
    console.warn(`${app.label}: package metadata reader warning: ${proc.stderr.trim()}`);
  }
  if (proc.status !== 0) {
    console.warn(`${app.label}: package metadata reader exited with ${proc.status}.`);
    return {};
  }

  try {
    return JSON.parse(proc.stdout || "{}") || {};
  } catch (error) {
    console.warn(`${app.label}: could not parse package metadata: ${error.message}`);
    return {};
  }
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

function safeNamePart(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}
