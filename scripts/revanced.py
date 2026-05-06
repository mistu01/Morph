#!/usr/bin/env python3

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
PATHS = {
    "tools": ROOT / ".cache" / "revanced" / "tools",
    "apks": ROOT / ".cache" / "revanced" / "apks",
    "tmp": ROOT / ".cache" / "revanced" / "tmp",
    "input": ROOT / "input" / "revanced",
    "output": ROOT / "output" / "revanced",
}

APP_CONFIGS = {
    "youtube": {
        "label": "YouTube",
        "package": "com.google.android.youtube",
        "apkpure_name": "YouTube",
        "apkpure_page": "https://apkpure.com/youtube-2025/com.google.android.youtube",
        "apkmirror_org": "google-inc",
        "apkmirror_repo": "youtube",
        "apkmirror_arch": "universal",
        "apkmirror_fallback_arch": "arm64-v8a",
        "apkmirror_dpi": "nodpi",
        "apkmirror_type": "apk",
        "input": "input/revanced/youtube.apk",
        "output": "output/revanced/youtube-revanced.apk",
    },
    "youtube-music": {
        "label": "YouTube Music",
        "package": "com.google.android.apps.youtube.music",
        "apkpure_name": "YouTube Music",
        "apkpure_page": "https://apkpure.com/youtube-music/com.google.android.apps.youtube.music",
        "apkmirror_org": "google-inc",
        "apkmirror_repo": "youtube-music",
        "apkmirror_arch": "arm64-v8a",
        "apkmirror_fallback_arch": "armeabi-v7a",
        "apkmirror_dpi": "nodpi",
        "apkmirror_type": "apk",
        "input": "input/revanced/youtube-music.apk",
        "output": "output/revanced/youtube-music-revanced.apk",
    },
    "reddit": {
        "label": "Reddit",
        "package": "com.reddit.frontpage",
        "apkpure_name": "Reddit",
        "apkpure_page": "https://apkpure.com/reddit-app/com.reddit.frontpage",
        "apkmirror_org": "redditinc",
        "apkmirror_repo": "reddit",
        "apkmirror_arch": "universal",
        "apkmirror_fallback_arch": "arm64-v8a",
        "apkmirror_dpi": "120-640dpi",
        "apkmirror_type": "bundle",
        "input": "input/revanced/reddit.apkm",
        "output": "output/revanced/reddit-revanced.apk",
    },
    "twitter": {
        "label": "X (Twitter)",
        "package": "com.twitter.android",
        "apkpure_name": "X",
        "apkpure_page": "https://apkpure.com/x/com.twitter.android",
        "apkmirror_org": "x-corp",
        "apkmirror_repo": "x-formerly-twitter",
        "apkmirror_arch": "universal",
        "apkmirror_fallback_arch": "arm64-v8a",
        "apkmirror_dpi": "nodpi",
        "apkmirror_type": "bundle",
        "input": "input/revanced/twitter.apkm",
        "output": "output/revanced/twitter-revanced.apk",
    },
    "instagram": {
        "label": "Instagram",
        "package": "com.instagram.android",
        "apkpure_name": "Instagram",
        "apkpure_page": "https://apkpure.com/instagram/com.instagram.android",
        "apkmirror_org": "instagram",
        "apkmirror_repo": "instagram-instagram",
        "apkmirror_arch": "universal",
        "apkmirror_fallback_arch": "arm64-v8a",
        "apkmirror_dpi": "nodpi",
        "apkmirror_type": "bundle",
        "input": "input/revanced/instagram.apkm",
        "output": "output/revanced/instagram-revanced.apk",
    },
}

CLI_ASSET = re.compile(r"revanced-cli-.+-all\.jar$")
PATCH_BUNDLE_ASSET = re.compile(r"(?:revanced-)?patches-.+\.(?:rvp|jar)$")
PATCH_JSON_ASSET = re.compile(r"(?:revanced-)?patches-.+\.json$|patches\.json$")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build APKs with official ReVanced patches.")
    parser.add_argument("command", nargs="?", default="build", choices=["tools", "approved-apps", "build", "release-notes", "clean"])
    parser.add_argument("--target", action="append", default=[])
    parser.add_argument("--force-download", action="store_true")
    args = parser.parse_args()

    if args.command == "tools":
        ensure_tools(force=truthy(env("REVANCED_REFRESH_TOOLS")))
    elif args.command == "approved-apps":
        tools = ensure_tools()
        approved = approved_packages(load_patches_metadata(tools))
        for package_name in sorted(approved):
            print(package_name)
    elif args.command == "build":
        build(args)
    elif args.command == "release-notes":
        print_release_notes()
    elif args.command == "clean":
        shutil.rmtree(ROOT / ".cache" / "revanced", ignore_errors=True)
        print("Removed .cache/revanced")

    return 0


def build(args: argparse.Namespace) -> None:
    check_java()
    tools = ensure_tools()
    patches = load_patches_metadata(tools)
    apps = selected_apps(args.target, patches)

    PATHS["output"].mkdir(parents=True, exist_ok=True)
    for app in apps:
        ensure_input(app, patches, force=args.force_download or truthy(env("AUTO_UPDATE_APKS")))
        patch_app(app, tools)


def ensure_tools(force: bool = False) -> dict:
    PATHS["tools"].mkdir(parents=True, exist_ok=True)
    cli = download_release_asset(
        repo=env("REVANCED_CLI_REPO") or "ReVanced/revanced-cli",
        version=env("REVANCED_CLI_VERSION") or "latest",
        pattern=CLI_ASSET,
        output=PATHS["tools"] / "revanced-cli.jar",
        meta=PATHS["tools"] / "revanced-cli.json",
        force=force,
    )
    patches = download_release_asset(
        repo=env("REVANCED_PATCHES_REPO") or "ReVanced/revanced-patches",
        version=env("REVANCED_PATCHES_VERSION") or "latest",
        pattern=PATCH_BUNDLE_ASSET,
        output=PATHS["tools"] / "revanced-patches.rvp",
        meta=PATHS["tools"] / "revanced-patches.json",
        force=force,
        direct_url=env("REVANCED_PATCHES_URL"),
        fallback_url=revanced_api_patches_url(env("REVANCED_PATCHES_VERSION") or "latest"),
    )
    patches_json = download_optional_patch_metadata(force=force)
    return {"cli": cli, "patches": patches, "patches_json": patches_json}


def download_optional_patch_metadata(force: bool = False) -> Path | None:
    output = PATHS["tools"] / "patches.json"
    if output.exists() and not force:
        return output

    direct_url = env("REVANCED_PATCHES_JSON_URL")
    if direct_url:
        download_file(direct_url, output)
        return output

    try:
        return download_release_asset(
            repo=env("REVANCED_PATCHES_REPO") or "ReVanced/revanced-patches",
            version=env("REVANCED_PATCHES_VERSION") or "latest",
            pattern=PATCH_JSON_ASSET,
            output=output,
            meta=PATHS["tools"] / "patches-json-release.json",
            force=force,
        )
    except Exception as error:
        print(f"warning: could not download ReVanced patch metadata JSON: {error}", file=sys.stderr)
        return None


def revanced_api_patches_url(version: str) -> str:
    if (version or "latest").lower() in {"latest", "stable"}:
        return "https://api.revanced.app/v5/patches.rvp"
    return ""


def load_patches_metadata(tools: dict) -> list[dict]:
    metadata_file = tools.get("patches_json")
    if metadata_file and Path(metadata_file).exists():
        data = read_json(Path(metadata_file))
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("patches", "data"):
                if isinstance(data.get(key), list):
                    return data[key]

    extracted = extract_patches_json(Path(tools["patches"]))
    if extracted:
        return extracted

    cli_metadata = load_patches_metadata_from_cli(tools)
    if cli_metadata:
        return cli_metadata

    if (env("REVANCED_APK_VERSION_SOURCE") or env("APK_VERSION_SOURCE") or "recommended").lower() == "latest":
        return []

    raise RuntimeError(
        "Could not load ReVanced patch metadata. Set REVANCED_PATCHES_JSON_URL or use REVANCED_APK_VERSION_SOURCE=latest."
    )


def load_patches_metadata_from_cli(tools: dict) -> list[dict]:
    if shutil.which("java") is None:
        return []

    commands = [
        ["java", "-jar", str(tools["cli"]), "list-patches", "--with-packages", "--with-versions", str(tools["patches"])],
        ["java", "-jar", str(tools["cli"]), "list-patches", "--with-packages", "--with-versions", "--json", str(tools["patches"])],
    ]
    for command in commands:
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
        output = f"{result.stdout}\n{result.stderr}".strip()
        if result.returncode != 0 or not output:
            continue
        parsed = parse_cli_patch_list(output)
        if parsed:
            write_json(PATHS["tools"] / "patches-cli.json", {"patches": parsed, "generatedAt": now()})
            return parsed
    return []


def parse_cli_patch_list(output: str) -> list[dict]:
    try:
        data = json.loads(output)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("patches"), list):
            return data["patches"]
    except json.JSONDecodeError:
        pass

    patches = []
    current = None
    current_package = None
    package_pattern = re.compile(r"\b([a-z]\w*(?:\.[a-z]\w*)+)\b")
    version_pattern = re.compile(r"\b\d+(?:\.\d+){1,5}\b")

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if not raw_line.startswith((" ", "\t", "-", "|")) and not package_pattern.search(line):
            current = {"name": line.rstrip(":"), "compatiblePackages": []}
            patches.append(current)
            current_package = None
            continue

        if current is None:
            current = {"name": "ReVanced patches", "compatiblePackages": []}
            patches.append(current)

        package_match = package_pattern.search(line)
        if package_match:
            current_package = {"name": package_match.group(1), "versions": []}
            current["compatiblePackages"].append(current_package)

        if current_package is not None:
            for version in version_pattern.findall(line):
                if version not in current_package["versions"]:
                    current_package["versions"].append(version)

    return [patch for patch in patches if patch.get("compatiblePackages")]


def extract_patches_json(bundle: Path) -> list[dict] | None:
    if not zipfile.is_zipfile(bundle):
        return None
    with zipfile.ZipFile(bundle) as archive:
        candidates = [name for name in archive.namelist() if name.endswith(".json") and "patch" in name.lower()]
        for name in candidates:
            try:
                data = json.loads(archive.read(name).decode("utf-8"))
            except Exception:
                continue
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and isinstance(data.get("patches"), list):
                return data["patches"]
    return None


def selected_apps(target_args: list[str], patches: list[dict]) -> list[dict]:
    requested = split_csv(",".join(target_args) or env("REVANCED_TARGETS") or env("BUILD_TARGETS") or "youtube,youtube-music,reddit")
    approved = approved_packages(patches)
    selected = []
    for target in requested:
        if target not in APP_CONFIGS:
            raise RuntimeError(f"Unknown ReVanced target {target}. Known targets: {', '.join(APP_CONFIGS)}")
        app = app_config(target)
        if approved and app["package"] not in approved:
            raise RuntimeError(f"{app['label']} ({app['package']}) is not approved by the selected ReVanced patch bundle.")
        selected.append(app)
    return selected


def approved_packages(patches: list[dict]) -> set[str]:
    packages = set()
    for patch in patches or []:
        for item in compatible_packages_from_patch(patch):
            package_name = item.get("name") or item.get("packageName") or item.get("package")
            if package_name:
                packages.add(str(package_name))
    return packages


def recommended_version(app: dict, patches: list[dict]) -> str:
    versions = set()
    for patch in patches or []:
        if patch.get("excluded") is True:
            continue
        for item in compatible_packages_from_patch(patch):
            package_name = item.get("name") or item.get("packageName") or item.get("package")
            if package_name != app["package"]:
                continue
            item_versions = item.get("versions") or item.get("versionNames") or []
            for version in item_versions:
                if version:
                    versions.add(str(version))
    return sorted(versions, key=version_key, reverse=True)[0] if versions else ""


def compatible_packages_from_patch(patch: dict) -> list[dict]:
    packages = patch.get("compatiblePackages") or patch.get("compatible_packages") or []
    if isinstance(packages, dict):
        return [{"name": name, **(value if isinstance(value, dict) else {"versions": value})} for name, value in packages.items()]
    return packages if isinstance(packages, list) else []


def ensure_input(app: dict, patches: list[dict], force: bool = False) -> None:
    direct_url = env(f"{app['env_prefix']}_APK_URL")
    metadata_file = metadata_file_for(app)
    metadata_file.parent.mkdir(parents=True, exist_ok=True)

    if direct_url:
        destination = Path(app["input"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {app['label']} from direct URL")
        download_file(direct_url, destination)
        write_json(metadata_file, {
            "app": app["id"],
            "packageName": app["package"],
            "source": "direct-url",
            "destination": str(destination),
            "downloadedAt": now(),
        })
        return

    source = (env("REVANCED_APK_VERSION_SOURCE") or env("APK_VERSION_SOURCE") or "recommended").lower()
    explicit = env(f"{app['env_prefix']}_APK_VERSION")
    version = explicit or ("" if source == "latest" else source if re.match(r"^\d+(?:\.\d+)+$", source) else recommended_version(app, patches))
    if source == "recommended" and not version:
        raise RuntimeError(f"No recommended ReVanced APK version found for {app['label']} in patch metadata.")

    destination = Path(app["input"])
    existing = read_json(metadata_file) if metadata_file.exists() else None
    if not force and destination.exists() and existing and existing.get("version") == (version or existing.get("version")):
        print(f"{app['label']} input already exists at {relative(destination)}")
        return

    errors = []
    for apk_source in split_csv(env("REVANCED_APK_SOURCE") or env("APK_SOURCE") or "apkmirror,apkpure"):
        try:
            metadata = download_from_source(app, apk_source, version)
            downloaded = Path(metadata["path"]).resolve()
            destination = replace_extension(destination, downloaded.suffix or ".apk")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.unlink(missing_ok=True)
            shutil.move(str(downloaded), destination)
            write_json(metadata_file, {
                **metadata,
                "app": app["id"],
                "packageName": app["package"],
                "desiredVersion": version or "latest",
                "destination": str(destination),
                "downloadedAt": now(),
            })
            app["input"] = str(destination)
            return
        except Exception as error:
            errors.append(f"{apk_source}: {error}")
    raise RuntimeError(f"{app['label']} APK could not be downloaded. {' | '.join(errors)}")


def download_from_source(app: dict, source: str, version: str) -> dict:
    output_dir = PATHS["apks"] / app["id"] / source
    shutil.rmtree(output_dir, ignore_errors=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    if source == "apkmirror":
        apkmirror_type = env(f"{app['env_prefix']}_APKMIRROR_TYPE") or app["apkmirror_type"]
        apkmirror_extension = "apkm" if apkmirror_type == "bundle" else "apk"
        args = [
            sys.executable, str(ROOT / "scripts" / "apkmirror_download.py"),
            "--app-name", app["label"],
            "--package-name", app["package"],
            "--org", app["apkmirror_org"],
            "--repo", app["apkmirror_repo"],
            "--out-dir", str(output_dir),
            "--version", version or "latest",
            "--arch", env(f"{app['env_prefix']}_APKMIRROR_ARCH") or env("APKMIRROR_ARCH") or app["apkmirror_arch"],
            "--dpi", env(f"{app['env_prefix']}_APKMIRROR_DPI") or env("APKMIRROR_DPI") or app["apkmirror_dpi"],
            "--type", apkmirror_type,
            "--out-file", f"{app['id']}-{version or 'latest'}.{apkmirror_extension}",
        ]
        fallback_arch = env(f"{app['env_prefix']}_APKMIRROR_FALLBACK_ARCH") or env("APKMIRROR_FALLBACK_ARCH") or app.get("apkmirror_fallback_arch")
        if fallback_arch:
            args += ["--fallback-arch", fallback_arch]
        return run_json(args)

    if source == "apkpure":
        args = [
            sys.executable, str(ROOT / "scripts" / "apkpure_download.py"),
            "--app-name", app["apkpure_name"],
            "--package-name", app["package"],
            "--source-page", app["apkpure_page"],
            "--out-dir", str(output_dir),
        ]
        if version:
            args += ["--version", version]
        return run_json(args)

    raise RuntimeError(f"Unsupported APK source {source}")


def patch_app(app: dict, tools: dict) -> None:
    output = Path(app["output"])
    output.parent.mkdir(parents=True, exist_ok=True)

    output.unlink(missing_ok=True)
    args = [
        "java", "-jar", str(tools["cli"]),
        "patch", str(app["input"]),
        "--patches", str(tools["patches"]),
        "--bypass-verification",
        "--out", str(output),
    ]

    args += signing_args()
    integrations = resolve_integrations()
    if integrations:
        args += ["--merge", integrations]
    args += patch_selection_args(app)

    print(f"\n==> Building ReVanced {app['label']}")
    run(args)
    write_json(result_file_for(app), {
        "app": app["id"],
        "label": app["label"],
        "packageName": app["package"],
        "input": str(app["input"]),
        "output": str(output),
        "patchBundle": str(tools["patches"]),
        "builtAt": now(),
    })


def patch_selection_args(app: dict) -> list[str]:
    args = []
    includes = split_csv(env(f"{app['env_prefix']}_REVANCED_INCLUDE_PATCHES") or env("REVANCED_INCLUDE_PATCHES"))
    excludes = split_csv(env(f"{app['env_prefix']}_REVANCED_EXCLUDE_PATCHES") or env("REVANCED_EXCLUDE_PATCHES"))
    if truthy(env("REVANCED_EXCLUSIVE")):
        args.append("--exclusive")
    for name in includes:
        args += ["-i", name]
    for name in excludes:
        args += ["-e", name]
    return args


def signing_args() -> list[str]:
    args = []
    mapping = [
        ("KEYSTORE_FILE", "--keystore"),
        ("KEYSTORE_PASSWORD", "--keystore-password"),
        ("KEYSTORE_ALIAS", "--keystore-entry-alias"),
        ("KEYSTORE_ENTRY_PASSWORD", "--keystore-entry-password"),
        ("SIGNER_NAME", "--signer"),
    ]
    for name, flag in mapping:
        value = env(name)
        if value:
            args += [flag, value]
    return args


def resolve_integrations() -> str:
    value = env("REVANCED_INTEGRATIONS_APK") or env("REVANCED_INTEGRATIONS")
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        destination = PATHS["tools"] / Path(urlparse(value).path).name
        download_file(value, destination)
        return str(destination)
    return value


def print_release_notes() -> None:
    apps = [app_config(target) for target in split_csv(env("REVANCED_TARGETS") or env("BUILD_TARGETS") or "youtube,youtube-music,reddit")]
    cli_meta = read_json(PATHS["tools"] / "revanced-cli.json")
    patches_meta = read_json(PATHS["tools"] / "revanced-patches.json")
    lines = [
        "Automated ReVanced patched APK build.",
        "",
        "## Build Summary",
        "",
        f"- Targets: {', '.join(app['label'] for app in apps)}",
        f"- ReVanced CLI: {cli_meta.get('tag', env('REVANCED_CLI_VERSION') or 'latest')}",
        f"- ReVanced patches: {patches_meta.get('tag', env('REVANCED_PATCHES_VERSION') or 'latest')}",
        f"- APK version source: {env('REVANCED_APK_VERSION_SOURCE') or env('APK_VERSION_SOURCE') or 'recommended'}",
        "",
        "## App Results",
        "",
    ]
    for app in apps:
        apk_meta = read_json(metadata_file_for(app))
        result = read_json(result_file_for(app))
        status = "successful" if result and Path(result.get("output", "")).exists() else "unknown"
        version = apk_meta.get("version") or apk_meta.get("desiredVersion") or "unknown"
        source = apk_meta.get("source") or "unknown"
        lines.append(f"- {app['label']} {version}: {status}")
        lines.append(f"  - Package: {app['package']}")
        lines.append(f"  - Source: {source}; {Path(result.get('output', app['output'])).name if result else Path(app['output']).name}")
    print("\n".join(lines))


def download_release_asset(
    repo: str,
    version: str,
    pattern: re.Pattern,
    output: Path,
    meta: Path,
    force: bool = False,
    direct_url: str | None = None,
    fallback_url: str = "",
) -> Path:
    if usable_file(output) and not force:
        return output
    output.unlink(missing_ok=True)
    if direct_url:
        download_file(direct_url, output)
        write_json(meta, {"repo": repo, "tag": version, "asset": Path(urlparse(direct_url).path).name, "downloadedAt": now()})
        return output

    try:
        release = github_release(repo, version)
        asset = next((item for item in release.get("assets", []) if pattern.match(item.get("name", ""))), None)
        if not asset:
            names = ", ".join(item.get("name", "") for item in release.get("assets", []))
            raise RuntimeError(f"No matching asset found for {repo} {release.get('tag_name')}. Assets: {names or 'none'}")
        print(f"Downloading {repo} {release['tag_name']}: {asset['name']}")
        download_file(asset["browser_download_url"], output)
        write_json(meta, {"repo": repo, "tag": release["tag_name"], "asset": asset["name"], "downloadedAt": now()})
    except Exception as error:
        if not fallback_url:
            raise
        print(f"warning: could not download {repo} from GitHub ({error}); using {fallback_url}", file=sys.stderr)
        download_file(fallback_url, output)
        write_json(meta, {"repo": repo, "tag": version, "asset": Path(urlparse(fallback_url).path).name, "fallbackUrl": fallback_url, "downloadedAt": now()})
    return output


def github_release(repo: str, version: str) -> dict:
    normalized = (version or "latest").lower()
    if normalized in {"latest", "stable"}:
        return github_json(f"https://api.github.com/repos/{repo}/releases/latest")
    if normalized in {"dev", "pre", "preview", "prerelease", "pre-release"}:
        releases = github_json(f"https://api.github.com/repos/{repo}/releases?per_page=100")
        release = next((item for item in releases if not item.get("draft") and item.get("prerelease")), None)
        if not release:
            raise RuntimeError(f"No prerelease found for {repo}")
        return release
    tag = version if version.startswith("v") else f"v{version}"
    return github_json(f"https://api.github.com/repos/{repo}/releases/tags/{tag}")


def github_json(url: str) -> dict:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "morph-revanced-builder"}
    if env("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {env('GITHUB_TOKEN')}"
    return json.loads(urlopen_with_retry(Request(url, headers=headers)).read().decode("utf-8"))


def download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "morph-revanced-builder"}
    if env("GITHUB_TOKEN") and "github.com" in url:
        headers["Authorization"] = f"Bearer {env('GITHUB_TOKEN')}"
    tmp = destination.with_suffix(f"{destination.suffix}.tmp")
    tmp.unlink(missing_ok=True)
    with urlopen_with_retry(Request(url, headers=headers)) as response, tmp.open("wb") as output:
        shutil.copyfileobj(response, output)
    tmp.replace(destination)


def urlopen_with_retry(request: Request, attempts: int = 4):
    last = None
    for attempt in range(1, attempts + 1):
        try:
            return urlopen(request, timeout=90)
        except (HTTPError, URLError, TimeoutError) as error:
            last = error
            if isinstance(error, HTTPError) and error.code not in {408, 425, 429, 500, 502, 503, 504}:
                raise
            time.sleep(0.75 * attempt)
    raise last


def app_config(target: str) -> dict:
    app = dict(APP_CONFIGS[target])
    app["id"] = target
    app["env_prefix"] = target.replace("-", "_").upper()
    app["input"] = str((ROOT / app["input"]).resolve())
    app["output"] = str((ROOT / app["output"]).resolve())
    return app


def metadata_file_for(app: dict) -> Path:
    return PATHS["apks"] / f"{app['id']}.json"


def result_file_for(app: dict) -> Path:
    return Path(app["output"]).with_name(f"{app['id']}-result.json")


def check_java() -> None:
    if shutil.which("java") is None:
        raise RuntimeError("Java is required to run ReVanced CLI.")


def run(args: list[str]) -> None:
    result = subprocess.run(args, cwd=ROOT)
    if result.returncode != 0:
        raise RuntimeError(f"{args[0]} exited with status {result.returncode}")


def run_json(args: list[str]) -> dict:
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip())
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Command produced invalid JSON: {result.stdout}") from error


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def split_csv(value: str | None) -> list[str]:
    return [item.strip() for item in (value or "").split(",") if item.strip()]


def env(name: str) -> str:
    return os.environ.get(name, "").strip()


def truthy(value: str | None) -> bool:
    return (value or "").lower() in {"1", "true", "yes", "on"}


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def version_key(value: str) -> tuple:
    return tuple(int(part) if part.isdigit() else part for part in re.split(r"[.-]", value))


def replace_extension(path: Path, extension: str) -> Path:
    return path.with_suffix(extension if extension.startswith(".") else f".{extension}")


def usable_file(path: Path) -> bool:
    try:
        return path.exists() and path.stat().st_size > 0
    except OSError:
        return False


def relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
