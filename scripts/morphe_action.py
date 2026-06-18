#!/usr/bin/env python3
"""Standalone GitHub Actions controller for Morphe CLI builds.

The workflow supplies configuration through environment variables. This script
downloads Morphe CLI and patch bundles, resolves/downloads a compatible APK,
applies Morphe's default patch selection plus optional overrides, validates the
result, and optionally creates a GitHub Release.
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence


ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = ROOT / ".morphe-action"
TOOLS_DIR = ROOT / ".cache" / "tools"
CLI_JAR = TOOLS_DIR / "morphe-cli.jar"
CACHE_DIR = STATE_DIR / "cache"
DOWNLOAD_DIR = STATE_DIR / "downloads"
OPTIONS_DIR = STATE_DIR / "options"
OUTPUT_DIR = STATE_DIR / "output"
TMP_DIR = STATE_DIR / "tmp"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36"
)
DEFAULT_PATCH_SOURCE = "https://github.com/MorpheApp/morphe-patches"
ARCHIVE_EXTENSIONS = {".apk", ".apkm", ".apks", ".xapk"}

APPS = {
    "youtube": ("YouTube", "com.google.android.youtube"),
    "youtube-music": ("YouTube Music", "com.google.android.apps.youtube.music"),
    "reddit": ("Reddit", "com.reddit.frontpage"),
}


class ActionError(RuntimeError):
    pass


@dataclass(frozen=True)
class CompatibleVersion:
    version: str
    patch_count: int


@dataclass(frozen=True)
class BuildConfig:
    app_id: str
    app_name: str
    package: str
    architecture: str
    apk_version: str
    apk_url: str
    apk_path: str
    patch_channel: str
    patch_sources: tuple[str, ...]
    enable_patches: tuple[str, ...]
    disable_patches: tuple[str, ...]
    force_patch: bool
    continue_on_error: bool
    release_mode: str
    release_tag: str


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def split_values(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in re.split(r"[,\n]", value) if part.strip())


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._+-]+", "-", value).strip(".-") or "artifact"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_archive(path: Path) -> None:
    if not path.is_file() or path.stat().st_size < 1024:
        raise ActionError(f"Archive is missing or too small: {path}")
    with path.open("rb") as stream:
        if stream.read(4) != b"PK\x03\x04":
            raise ActionError(f"File is not an APK/ZIP archive: {path}")


def github_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Morph-Morphe-Action",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = env("GH_TOKEN") or env("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_json(url: str) -> Any:
    request = urllib.request.Request(url, headers=github_headers())
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def curl_path() -> str:
    value = shutil.which("curl")
    if not value:
        raise ActionError("curl is required")
    return value


def curl_download(url: str, target: Path, referer: str = "") -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.stat().st_size > 1024:
        return target
    partial = target.with_suffix(target.suffix + ".part")
    args = [curl_path(), "-sS", "-fL", "--retry", "3", "-A", USER_AGENT]
    token = env("GH_TOKEN") or env("GITHUB_TOKEN")
    if token and "github" in urllib.parse.urlparse(url).netloc:
        args.extend(["-H", f"Authorization: Bearer {token}"])
    if referer:
        args.extend(["-e", referer])
    args.extend(["-o", str(partial), url])
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        partial.unlink(missing_ok=True)
        raise ActionError(result.stderr.strip() or f"Download failed: {url}")
    partial.replace(target)
    return target


def curl_text(url: str, referer: str = "") -> tuple[str, str]:
    marker = "\n__MORPHE_FINAL_URL__="
    args = [curl_path(), "-sS", "-fL", "--max-redirs", "8", "-A", USER_AGENT]
    if referer:
        args.extend(["-e", referer])
    args.extend(["-w", marker + "%{url_effective}", url])
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        raise ActionError(result.stderr.decode("utf-8", errors="replace").strip() or "HTTP request failed")
    output = result.stdout.decode("utf-8", errors="replace")
    if marker not in output:
        raise ActionError("HTTP response did not include its final URL")
    body, final_url = output.rsplit(marker, 1)
    return body, final_url.strip()


def redirect_location(url: str) -> str:
    result = subprocess.run(
        [curl_path(), "-sS", "-I", "--max-redirs", "0", "-A", USER_AGENT, url],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    matches = re.findall(r"^location:\s*(.+)$", result.stdout, flags=re.I | re.M)
    if not matches:
        raise ActionError(result.stderr.strip() or f"No redirect returned by {url}")
    return urllib.parse.urljoin(url, matches[-1].strip())


def choose_release(releases: Sequence[dict[str, Any]], channel: str, version: str = "") -> dict[str, Any]:
    normalized = version.strip()
    if normalized and normalized.lower() not in {"latest", "stable", "dev"}:
        candidates = {normalized, normalized if normalized.startswith("v") else f"v{normalized}"}
        selected = next((release for release in releases if release.get("tag_name") in candidates), None)
        if not selected:
            raise ActionError(f"Release {version} was not found")
        return selected

    requested_channel = normalized.lower() if normalized.lower() in {"stable", "dev"} else channel
    for release in releases:
        tag = str(release.get("tag_name", ""))
        is_dev = bool(release.get("prerelease")) or "dev" in tag.lower()
        if (requested_channel == "dev" and is_dev) or (requested_channel == "stable" and not is_dev):
            return release
    raise ActionError(f"No {requested_channel} release was found")


def github_release(repo: str, channel: str, version: str = "") -> dict[str, Any]:
    releases = fetch_json(f"https://api.github.com/repos/{repo}/releases?per_page=100")
    return choose_release(releases, channel, version)


def release_asset(release: dict[str, Any], pattern: re.Pattern[str]) -> dict[str, Any]:
    asset = next((item for item in release.get("assets", []) if pattern.search(str(item.get("name", "")))), None)
    if not asset:
        raise ActionError(f"No matching asset found in {release.get('tag_name')}")
    return asset


def install_cli(channel: str, version: str) -> Path:
    release = github_release("MorpheApp/morphe-cli", channel, version)
    asset = release_asset(release, re.compile(r"morphe-cli-.+-all\.jar$", re.I))
    print(f"Morphe CLI: {release['tag_name']} ({asset['name']})")
    CLI_JAR.parent.mkdir(parents=True, exist_ok=True)
    CLI_JAR.unlink(missing_ok=True)
    curl_download(str(asset["browser_download_url"]), CLI_JAR)
    if CLI_JAR.stat().st_size < 1_000_000:
        raise ActionError("Downloaded Morphe CLI JAR is unexpectedly small")
    write_output("cli_jar", str(CLI_JAR))
    write_output("cli_tag", str(release["tag_name"]))
    return CLI_JAR


def materialize_patch_source(source: str, channel: str) -> Path:
    parsed = urllib.parse.urlparse(source)
    if parsed.netloc.lower() not in {"github.com", "www.github.com"}:
        path = Path(source).expanduser().resolve()
        if not path.is_file():
            raise ActionError(f"Only GitHub URLs or local .mpp files are supported: {source}")
        return path
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        raise ActionError(f"Invalid GitHub patch source: {source}")
    repo = f"{parts[0]}/{parts[1].removesuffix('.git')}"
    pinned = ""
    match = re.search(r"/releases?/tag/([^/]+)", parsed.path, re.I)
    if match:
        pinned = urllib.parse.unquote(match.group(1))
    release = github_release(repo, channel, pinned)
    asset = release_asset(release, re.compile(r"\.mpp$", re.I))
    target = CACHE_DIR / "patches" / safe_name(repo) / safe_name(str(release["tag_name"])) / safe_name(str(asset["name"]))
    print(f"Patch source {repo}: {release['tag_name']}")
    return curl_download(str(asset["browser_download_url"]), target)


def run_command(
    args: Sequence[str],
    *,
    capture: bool = False,
    secrets: Sequence[str] = (),
    drop_github_token: bool = False,
) -> subprocess.CompletedProcess[str]:
    rendered = shlex.join(str(arg) for arg in args)
    for secret in secrets:
        if secret:
            rendered = rendered.replace(secret, "<redacted>")
    print(f"+ {rendered}", flush=True)
    child_env = os.environ.copy()
    if drop_github_token:
        child_env.pop("GH_TOKEN", None)
        child_env.pop("GITHUB_TOKEN", None)
    result = subprocess.run(
        [str(arg) for arg in args],
        cwd=ROOT,
        env=child_env,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
        errors="replace",
        check=False,
    )
    if capture and result.stdout:
        print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
    if result.returncode != 0:
        raise ActionError(f"Command exited with {result.returncode}")
    return result


def morphe(command: str, args: Sequence[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    if not CLI_JAR.is_file():
        raise ActionError(f"Morphe CLI is not installed at {CLI_JAR}")
    secrets = (env("KEYSTORE_PASSWORD"), env("KEYSTORE_ENTRY_PASSWORD"))
    return run_command(
        ["java", "-jar", str(CLI_JAR), command, *args],
        capture=capture,
        secrets=secrets,
        drop_github_token=True,
    )


def parse_compatible_versions(output: str) -> list[CompatibleVersion]:
    pattern = re.compile(r"^\s*([^\s]+)\s+\((\d+)\s+patch(?:es)?\)\s*$", re.I)
    versions: list[CompatibleVersion] = []
    for line in output.splitlines():
        match = pattern.match(line)
        if match:
            versions.append(CompatibleVersion(match.group(1), int(match.group(2))))
    return versions


def recommended_version(package: str, patches: Sequence[Path]) -> CompatibleVersion:
    args = ["-t", str(TMP_DIR), "-f", package]
    for patch in patches:
        args.extend(["--patches", str(patch)])
    result = morphe("list-versions", args, capture=True)
    versions = parse_compatible_versions(result.stdout or "")
    if not versions:
        raise ActionError(f"No compatible APK version was reported for {package}")
    return versions[0]


def extract_apkmirror_links(page_url: str, body: str) -> tuple[str | None, str | None]:
    decoded = html.unescape(body)
    hrefs = re.findall(r'href=["\']([^"\']+)["\']', decoded, flags=re.I)
    intermediate = next((href for href in hrefs if "/download/?key=" in href), None)
    direct = next((href for href in hrefs if "download.php?" in href), None)
    return (
        urllib.parse.urljoin(page_url, intermediate) if intermediate else None,
        urllib.parse.urljoin(page_url, direct) if direct else None,
    )


def resolve_apk_download(package: str, version: str, architecture: str) -> tuple[str, str]:
    query = urllib.parse.quote(f"{package}~{version}~{architecture}", safe="")
    resolver = f"https://api.morphe.software/v2/web-search/{query}"
    landing = redirect_location(resolver)
    if "apkmirror.com" not in urllib.parse.urlparse(landing).netloc:
        return landing, landing
    body, landing = curl_text(landing)
    intermediate, direct = extract_apkmirror_links(landing, body)
    if not direct:
        if not intermediate:
            raise ActionError("APKMirror landing page contains no download link")
        second_body, second_url = curl_text(intermediate, landing)
        _, direct = extract_apkmirror_links(second_url, second_body)
    if not direct:
        raise ActionError("APKMirror binary endpoint could not be resolved")
    return landing, direct


def direct_download_name(url: str, referer: str, fallback: str) -> str:
    result = subprocess.run(
        [curl_path(), "-sS", "-I", "-A", USER_AGENT, "-e", referer, url],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    matches = re.findall(r"^location:\s*(.+)$", result.stdout, flags=re.I | re.M)
    if matches:
        name = Path(urllib.parse.unquote(urllib.parse.urlparse(matches[-1].strip()).path)).name
        if Path(name).suffix.lower() in ARCHIVE_EXTENSIONS:
            return safe_name(name)
    return safe_name(fallback)


def acquire_apk(config: BuildConfig, version: str) -> Path:
    if config.apk_path:
        path = Path(config.apk_path).expanduser().resolve()
        verify_archive(path)
        print(f"Using supplied APK: {path}")
        return path
    if config.apk_url:
        suffix = Path(urllib.parse.urlparse(config.apk_url).path).suffix.lower()
        suffix = suffix if suffix in ARCHIVE_EXTENSIONS else ".apk"
        target = DOWNLOAD_DIR / f"{safe_name(config.app_id)}-{safe_name(version)}{suffix}"
        curl_download(config.apk_url, target)
        verify_archive(target)
        return target
    landing, direct = resolve_apk_download(config.package, version, config.architecture)
    name = direct_download_name(direct, landing, f"{config.app_id}-{version}.apk")
    target = DOWNLOAD_DIR / name
    curl_download(direct, target, landing)
    verify_archive(target)
    print(f"APK: {target} ({target.stat().st_size} bytes)")
    return target


def create_options(config: BuildConfig, patches: Sequence[Path]) -> Path:
    OPTIONS_DIR.mkdir(parents=True, exist_ok=True)
    output = OPTIONS_DIR / f"{safe_name(config.app_id)}-{config.patch_channel}.json"
    args = ["-o", str(output), "-t", str(TMP_DIR), "-f", config.package]
    for patch in patches:
        args.extend(["-p", str(patch)])
    morphe("options-create", args)
    apply_patch_overrides(output, config.enable_patches, config.disable_patches)
    return output


def apply_patch_overrides(path: Path, enable: Sequence[str], disable: Sequence[str]) -> None:
    bundles = json.loads(path.read_text(encoding="utf-8"))
    requested = {name.casefold(): True for name in enable}
    requested.update({name.casefold(): False for name in disable})
    found: set[str] = set()
    for bundle in bundles:
        for name, entry in bundle.get("patches", {}).items():
            key = name.casefold()
            if key in requested:
                entry["enabled"] = requested[key]
                found.add(key)
    missing = sorted(set(requested) - found)
    if missing:
        raise ActionError(f"Patch override names were not found: {', '.join(missing)}")
    path.write_text(json.dumps(bundles, indent=2) + "\n", encoding="utf-8")


def signing_args() -> list[str]:
    keystore = env("KEYSTORE_FILE")
    if not keystore:
        print("No signing secret configured; Morphe will use its generated signing key.")
        return []
    path = Path(keystore).resolve()
    if not path.is_file():
        raise ActionError(f"KEYSTORE_FILE does not exist: {path}")
    password = env("KEYSTORE_PASSWORD")
    alias = env("KEYSTORE_ALIAS", "mistu")
    entry_password = env("KEYSTORE_ENTRY_PASSWORD", password)
    if not password or not entry_password:
        raise ActionError("Signing keystore passwords are missing")
    return [
        "--keystore", str(path),
        "--keystore-password", password,
        "--keystore-entry-alias", alias,
        "--keystore-entry-password", entry_password,
        "--signer", env("SIGNER_NAME", "Morph"),
    ]


def build_apk(config: BuildConfig, version: str, apk: Path, patches: Sequence[Path], options: Path) -> tuple[Path, Path]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    output = OUTPUT_DIR / f"{safe_name(config.app_id)}-{safe_name(version)}-{config.patch_channel}-patched.apk"
    result_file = output.with_suffix(".result.json")
    args = ["-o", str(output), "-r", str(result_file), "-t", str(TMP_DIR)]
    for patch in patches:
        args.extend(["-p", str(patch)])
    args.extend(["--options-file", str(options), "--purge"])
    if config.force_patch:
        args.append("--force")
    if config.continue_on_error:
        args.append("--continue-on-error")
    args.extend(signing_args())
    args.append(str(apk))
    morphe("patch", args)
    verify_archive(output)
    if not result_file.is_file():
        raise ActionError("Morphe did not write its result JSON")
    return output, result_file


def validate_result(path: Path) -> tuple[dict[str, Any], int, int]:
    result = json.loads(path.read_text(encoding="utf-8"))
    failed_steps = [step["step"] for step in result.get("patchingSteps", []) if not step.get("success")]
    failed_patches = result.get("failedPatches", [])
    applied_patches = result.get("appliedPatches", [])
    if failed_steps:
        raise ActionError(f"Morphe steps failed: {', '.join(failed_steps)}")
    if failed_patches:
        raise ActionError(f"{len(failed_patches)} patch(es) failed")
    return result, len(applied_patches), len(failed_patches)


def release_tag(config: BuildConfig, version: str) -> str:
    if config.release_tag:
        return safe_name(config.release_tag)
    run = env("GITHUB_RUN_NUMBER", "local")
    attempt = env("GITHUB_RUN_ATTEMPT", "1")
    return safe_name(f"morphe-{config.app_id}-{version}-{config.patch_channel}-{run}.{attempt}")


def create_release(config: BuildConfig, version: str, artifact: Path, result_file: Path, applied: int) -> str:
    if config.release_mode == "artifact-only":
        return ""
    if not shutil.which("gh"):
        raise ActionError("GitHub CLI is unavailable")
    repo = env("GITHUB_REPOSITORY")
    if not repo:
        raise ActionError("GITHUB_REPOSITORY is missing")
    tag = release_tag(config, version)
    notes_file = OUTPUT_DIR / "release-notes.md"
    notes_file.write_text(
        "\n".join(
            [
                f"# {config.app_name} {version}",
                "",
                f"- Package: `{config.package}`",
                f"- Architecture request: `{config.architecture}`",
                f"- Patch channel: `{config.patch_channel}`",
                f"- Applied patches: `{applied}`",
                f"- APK SHA-256: `{sha256_file(artifact)}`",
                "",
                "Built automatically with Morphe CLI using its recommended patch defaults.",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    args = [
        "gh", "release", "create", tag, str(artifact), str(result_file),
        "--repo", repo,
        "--title", f"{config.app_name} {version} ({config.patch_channel})",
        "--notes-file", str(notes_file),
    ]
    if config.release_mode == "draft":
        args.append("--draft")
    elif config.patch_channel == "dev":
        args.append("--prerelease")
    result = run_command(args, capture=True)
    return (result.stdout or "").strip().splitlines()[-1] if result.stdout else ""


def load_config() -> BuildConfig:
    app_id = env("APP_SELECTION", "reddit")
    if app_id == "custom":
        package = env("CUSTOM_PACKAGE")
        if not re.fullmatch(r"[A-Za-z]\w*(?:\.[A-Za-z]\w*)+", package):
            raise ActionError("CUSTOM_PACKAGE must be a valid Android package name")
        app_name = env("CUSTOM_APP_NAME", package.rsplit(".", 1)[-1].title())
    elif app_id in APPS:
        app_name, package = APPS[app_id]
    else:
        raise ActionError(f"Unknown app selection: {app_id}")
    patch_channel = env("PATCH_CHANNEL", "stable").lower()
    if patch_channel not in {"stable", "dev"}:
        raise ActionError("PATCH_CHANNEL must be stable or dev")
    release_mode = env("RELEASE_MODE", "release").lower()
    if release_mode not in {"release", "draft", "artifact-only"}:
        raise ActionError("RELEASE_MODE must be release, draft, or artifact-only")
    return BuildConfig(
        app_id=app_id if app_id != "custom" else safe_name(package),
        app_name=app_name,
        package=package,
        architecture=env("APK_ARCHITECTURE", "all"),
        apk_version=env("APK_VERSION"),
        apk_url=env("APK_URL"),
        apk_path=env("APK_PATH"),
        patch_channel=patch_channel,
        patch_sources=split_values(env("PATCH_SOURCES", DEFAULT_PATCH_SOURCE)),
        enable_patches=split_values(env("ENABLE_PATCHES")),
        disable_patches=split_values(env("DISABLE_PATCHES")),
        force_patch=truthy(env("FORCE_PATCH", "false")),
        continue_on_error=truthy(env("CONTINUE_ON_ERROR", "false")),
        release_mode=release_mode,
        release_tag=env("RELEASE_TAG"),
    )


def write_output(name: str, value: str) -> None:
    output_file = env("GITHUB_OUTPUT")
    if output_file:
        with Path(output_file).open("a", encoding="utf-8") as stream:
            stream.write(f"{name}={value}\n")


def write_summary(lines: Sequence[str]) -> None:
    summary_file = env("GITHUB_STEP_SUMMARY")
    if summary_file:
        with Path(summary_file).open("a", encoding="utf-8") as stream:
            stream.write("\n".join(lines) + "\n")


def run_action() -> None:
    config = load_config()
    for directory in (CACHE_DIR, DOWNLOAD_DIR, OPTIONS_DIR, OUTPUT_DIR, TMP_DIR):
        directory.mkdir(parents=True, exist_ok=True)
    if not CLI_JAR.is_file():
        install_cli(env("CLI_CHANNEL", "stable"), env("CLI_VERSION", "latest"))
    patches = [materialize_patch_source(source, config.patch_channel) for source in config.patch_sources]
    compatible = recommended_version(config.package, patches)
    version = config.apk_version or compatible.version
    print(f"Selected {config.app_name} {version}; recommended={compatible.version}")
    apk = acquire_apk(config, version)
    options = create_options(config, patches)
    artifact, result_file = build_apk(config, version, apk, patches, options)
    _, applied, failed = validate_result(result_file)
    digest = sha256_file(artifact)
    write_output("artifact_path", str(artifact.relative_to(ROOT)))
    write_output("result_path", str(result_file.relative_to(ROOT)))
    write_output("app_version", version)
    release_url = create_release(config, version, artifact, result_file, applied)
    write_output("release_url", release_url)
    write_summary(
        [
            f"## Morphe build: {config.app_name} {version}",
            "",
            f"- Package: `{config.package}`",
            f"- Patch channel: `{config.patch_channel}`",
            f"- Recommended version: `{compatible.version}`",
            f"- Applied patches: `{applied}`",
            f"- Failed patches: `{failed}`",
            f"- Output: `{artifact.relative_to(ROOT)}`",
            f"- SHA-256: `{digest}`",
            f"- Release: {release_url or 'artifact only'}",
        ]
    )
    print(json.dumps({
        "artifact": str(artifact),
        "version": version,
        "applied_patches": applied,
        "failed_patches": failed,
        "sha256": digest,
        "release_url": release_url,
    }, indent=2))


def doctor() -> None:
    report = {
        "python": sys.version.split()[0],
        "java": shutil.which("java"),
        "curl": shutil.which("curl"),
        "gh": shutil.which("gh"),
        "cli": str(CLI_JAR),
        "cli_exists": CLI_JAR.is_file(),
    }
    print(json.dumps(report, indent=2))
    if not report["java"] or not report["curl"]:
        raise ActionError("Java and curl are required")


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "action"
    try:
        if command == "install-cli":
            install_cli(env("CLI_CHANNEL", "stable"), env("CLI_VERSION", "latest"))
        elif command == "action":
            run_action()
        elif command == "doctor":
            doctor()
        else:
            raise ActionError(f"Unknown command: {command}")
        return 0
    except (ActionError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
