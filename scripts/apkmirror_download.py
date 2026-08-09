#!/usr/bin/env python3

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup


BASE_URL = "https://www.apkmirror.com"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Download APKMirror APKs by app, version, and variant.")
    parser.add_argument("--app-name", required=True)
    parser.add_argument("--package-name", required=True)
    parser.add_argument("--org", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--slug", default="")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--version", default="latest")
    parser.add_argument("--arch", default="universal")
    parser.add_argument("--fallback-arch", default="")
    parser.add_argument("--dpi", default="nodpi")
    parser.add_argument("--type", default="apk", choices=["apk", "bundle"])
    parser.add_argument("--out-file", default="")
    args = parser.parse_args()

    version_page = select_version_page(args.org, args.repo, args.version, args.slug)
    variants = select_variants(version_page, args)

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if len(variants) == 1:
        variant = variants[0]
        download_page, download_url = resolve_download_url(variant["url"])
        filename = args.out_file or filename_from_url(download_url) or f"{args.repo}-{variant['version']}.apk"
        path = out_dir / filename
        download_binary(args.app_name, download_url, download_page, path)

        print(json.dumps(metadata_for_single_variant(args, version_page, variant, download_page, download_url, path)))
        return 0

    if args.type != "bundle":
        raise RuntimeError(f"{args.app_name}: multiple APKMirror variants can only be packed when --type bundle is used.")
    ensure_compatible_variant_set(args.app_name, variants)

    filename = args.out_file or f"{args.repo}-{variants[0]['version']}.apkm"
    path = out_dir / filename

    with tempfile.TemporaryDirectory(prefix="apkmirror-variants-") as tmp:
        tmp_dir = Path(tmp)
        downloaded = []
        for index, variant in enumerate(variants, start=1):
            download_page, download_url = resolve_download_url(variant["url"])
            variant_path = tmp_dir / f"{index:02d}-{safe_filename(variant['arch'])}-{safe_filename(variant['dpi'])}.apkm"
            download_binary(args.app_name, download_url, download_page, variant_path)
            downloaded.append({
                "variant": variant,
                "downloadPage": download_page,
                "downloadUrl": download_url,
                "path": variant_path,
                "size": format_bytes(variant_path.stat().st_size),
            })

        combine_split_archives(args.app_name, downloaded, path)

    print(json.dumps(metadata_for_combined_variants(args, version_page, downloaded, path)))
    return 0


def download_binary(app_name: str, download_url: str, referer: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open_url(download_url, referer=referer, accept="application/vnd.android.package-archive,*/*") as response:
        content_type = response.headers.get("Content-Type", "")
        if "text/html" in content_type.lower():
            raise RuntimeError(f"{app_name}: APKMirror returned HTML instead of an APK for {download_url}")

        with path.open("wb") as output:
            shutil.copyfileobj(response, output)


def metadata_for_single_variant(
    args: argparse.Namespace,
    version_page: dict[str, str],
    variant: dict[str, str],
    download_page: str,
    download_url: str,
    path: Path,
) -> dict[str, object]:
    return {
        "appName": args.app_name,
        "packageName": args.package_name,
        "source": "apkmirror",
        "sourcePage": version_page["url"],
        "variantPage": variant["url"],
        "downloadPage": download_page,
        "downloadUrl": download_url,
        "path": str(path),
        "filename": path.name,
        "version": variant["version"],
        "versionCode": variant.get("versionCode", ""),
        "fileType": variant["type"].upper(),
        "arch": variant["arch"],
        "dpi": variant["dpi"],
        "minAndroidVersion": variant.get("minAndroidVersion", ""),
        "size": format_bytes(path.stat().st_size),
    }


def metadata_for_combined_variants(
    args: argparse.Namespace,
    version_page: dict[str, str],
    downloaded: list[dict[str, object]],
    path: Path,
) -> dict[str, object]:
    variants = [item["variant"] for item in downloaded]
    version_codes = [item.get("versionCode", "") for item in variants]
    return {
        "appName": args.app_name,
        "packageName": args.package_name,
        "source": "apkmirror",
        "sourcePage": version_page["url"],
        "variantPages": [item["url"] for item in variants],
        "downloadPages": [item["downloadPage"] for item in downloaded],
        "downloadUrls": [item["downloadUrl"] for item in downloaded],
        "path": str(path),
        "filename": path.name,
        "version": variants[0]["version"],
        "versionCode": ",".join(dict.fromkeys(version_codes)),
        "fileType": "APKM",
        "arch": ",".join(item["arch"] for item in variants),
        "dpi": ",".join(item["dpi"] for item in variants),
        "minAndroidVersion": ",".join(item.get("minAndroidVersion", "") for item in variants),
        "size": format_bytes(path.stat().st_size),
        "variants": [
            {
                "version": item["variant"]["version"],
                "versionCode": item["variant"].get("versionCode", ""),
                "type": item["variant"]["type"],
                "arch": item["variant"]["arch"],
                "dpi": item["variant"]["dpi"],
                "minAndroidVersion": item["variant"].get("minAndroidVersion", ""),
                "variantPage": item["variant"]["url"],
                "downloadPage": item["downloadPage"],
                "downloadUrl": item["downloadUrl"],
                "size": item["size"],
            }
            for item in downloaded
        ],
    }


def ensure_compatible_variant_set(app_name: str, variants: list[dict[str, str]]) -> None:
    versions = sorted({item.get("version", "") for item in variants if item.get("version")})
    version_codes = sorted({item.get("versionCode", "") for item in variants if item.get("versionCode")})
    if len(versions) > 1 or len(version_codes) > 1:
        summary = ", ".join(
            f"{item['arch']} {item['dpi']} version={item.get('version', 'unknown')} "
            f"versionCode={item.get('versionCode', 'unknown')}"
            for item in variants
        )
        raise RuntimeError(
            f"{app_name}: APKMirror variants are not install-compatible and cannot be packed together. "
            f"Selected variants: {summary}. "
            "Use a narrower APKMIRROR_ARCH/APKMIRROR_DPI selection or let the workflow fall back to APKPure."
        )


def combine_split_archives(app_name: str, downloaded: list[dict[str, object]], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    written: dict[str, str] = {}
    apk_count = 0
    base_seen = False

    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for item in downloaded:
            variant_path = item["path"]
            if not zipfile.is_zipfile(variant_path):
                raise RuntimeError(f"{app_name}: APKMirror bundle variant was not a split APK archive: {variant_path}")

            with zipfile.ZipFile(variant_path) as archive:
                for entry in archive.infolist():
                    if entry.is_dir() or not entry.filename.lower().endswith(".apk"):
                        continue
                    output_name = archive_apk_output_name(entry.filename)
                    data = archive.read(entry)
                    digest = hashlib.sha256(data).hexdigest()

                    if output_name in written:
                        if written[output_name] == digest:
                            continue
                        raise RuntimeError(
                            f"{app_name}: APKMirror variants contain conflicting APK split {output_name}; "
                            "choose a narrower APKMIRROR_ARCH/APKMIRROR_DPI set."
                        )

                    output.writestr(output_name, data)
                    written[output_name] = digest
                    apk_count += 1
                    if output_name == "base.apk":
                        base_seen = True

    if not apk_count:
        raise RuntimeError(f"{app_name}: APKMirror variants did not contain APK files.")
    if not base_seen:
        raise RuntimeError(f"{app_name}: APKMirror variants did not contain base.apk.")


def archive_apk_output_name(entry_name: str) -> str:
    normalized = entry_name.replace("\\", "/")
    name = Path(normalized).name
    if name == "base.apk":
        return name
    return safe_filename(name)


def safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._-") or "variant"


def select_version_page(org: str, repo: str, requested: str, slug: str = "") -> dict[str, str]:
    if requested and requested not in {"latest", "stable"}:
        # Clean architecture suffixes from the requested version name for APKMirror URL lookup
        requested_clean = re.sub(
            r'-+(arm64-v8a|arm64_v8a|arm64|armeabi-v7a|armeabi_v7a|armv7|arm-v7a|armeabi|x86_64|x86-64|x86|mips|mips64|universal)$',
            '',
            requested,
            flags=re.IGNORECASE
        )
        release_slug = slug or repo
        # Try primary URL pattern with -release suffix
        url1 = f"{BASE_URL}/apk/{org}/{repo}/{release_slug}-{requested_clean.replace('.', '-')}-release/"
        # Try secondary URL pattern without -release suffix
        url2 = f"{BASE_URL}/apk/{org}/{repo}/{release_slug}-{requested_clean.replace('.', '-')}/"
        # Try tertiary URL pattern with clean version replacing dots with dashes
        dots_to_dashes = requested_clean.replace('.', '-')
        url3 = f"{BASE_URL}/apk/{org}/{repo}/{release_slug}-{dots_to_dashes}/"
        
        errors = []
        for url in [url1, url2, url3]:
            try:
                ensure_page_exists(url)
                return {"name": requested_clean, "url": url}
            except Exception as e:
                errors.append(str(e))
                
        # Scrape and search if direct URLs return 404
        try:
            list_url = f"{BASE_URL}/apk/{org}/{repo}/"
            soup = soup_from_url(list_url)
            version_list = soup.select_one('.listWidget:has(a[name="all_versions"])')
            if version_list:
                for row in version_list.select(".table-row"):
                    link = row.select_one(".table-cell:nth-of-type(2) a[href]")
                    if not link:
                        continue
                    name = link.get_text(" ", strip=True)
                    href = link.get("href")
                    if name and href:
                        def clean(v: str) -> str:
                            v = v.lower().strip()
                            v = re.sub(r'[-_]', '.', v)
                            v = re.sub(r'\b(release|stable|beta|alpha|ripped|prod|final|android)\b', '', v)
                            v = re.sub(r'\.+', '.', v)
                            v = v.strip('.')
                            return v
                        if clean(name) == clean(requested_clean) or clean(requested_clean) in clean(name):
                            return {"name": name, "url": absolute_url(href)}
        except Exception as scrape_err:
            errors.append(f"Scrape fallback failed: {scrape_err}")
            
        raise RuntimeError(f"Could not resolve APKMirror version page for {requested} (cleaned: {requested_clean}). Tried: " + " | ".join(errors))




    url = f"{BASE_URL}/apk/{org}/{repo}/"
    soup = soup_from_url(url)
    versions = []
    version_list = soup.select_one('.listWidget:has(a[name="all_versions"])')
    if version_list:
        for row in version_list.select(".table-row"):
            link = row.select_one(".table-cell:nth-of-type(2) a[href]")
            if not link:
                continue
            name = link.get_text(" ", strip=True)
            href = link.get("href")
            if name and href:
                versions.append({"name": name, "url": absolute_url(href)})

    if not versions:
        raise RuntimeError(f"Could not find APKMirror versions for {org}/{repo}")

    if requested == "stable":
        selected = next((item for item in versions if "beta" not in item["name"].lower() and "alpha" not in item["name"].lower()), None)
    else:
        selected = versions[0]

    if not selected:
        raise RuntimeError(f"Could not find a suitable APKMirror {requested or 'latest'} version for {org}/{repo}")

    return selected


def ensure_page_exists(url: str) -> None:
    try:
        soup_from_url(url)
    except RuntimeError as exc:
        raise RuntimeError(f"APKMirror page was not available: {url}. {exc}") from exc


def select_variants(version_page: dict[str, str], args: argparse.Namespace) -> list[dict[str, str]]:
    soup = soup_from_url(version_page["url"])
    variants = parse_variants(soup)
    if variants:
        selected = selected_variants_for_arches(variants, args)
        if selected:
            return selected

    direct = direct_download_button(soup)
    if direct:
        return [{
            "version": version_page["name"],
            "type": args.type,
            "arch": args.arch,
            "dpi": args.dpi,
            "url": direct,
        }]

    if variants:
        summary = ", ".join(f"{item['version']} {item['type']} {item['arch']} {item['dpi']}" for item in variants[:12])
        raise RuntimeError(
            f"Could not find APKMirror {args.type.upper()} variant for "
            f"arch={args.arch}, dpi={args.dpi}. Available: {summary or 'none'}"
        )

    raise RuntimeError(f"Could not find APKMirror variants at {version_page['url']}")


def selected_variants_for_arches(variants: list[dict[str, str]], args: argparse.Namespace) -> list[dict[str, str]]:
    arches = split_values(args.arch) or ["universal"]
    fallback_arches = split_values(args.fallback_arch)
    selected: list[dict[str, str]] = []

    if any(arch in {"all", "full"} for arch in arches):
        candidates = filter_variants(variants, args.dpi, args.type)
        for arch in sorted({item["arch"].lower() for item in candidates}):
            add_unique_variant(selected, find_variant(variants, arch, args.dpi, args.type))
        return selected

    for arch in arches:
        add_unique_variant(selected, find_variant(variants, arch, args.dpi, args.type))

    if selected:
        return selected

    for arch in fallback_arches:
        add_unique_variant(selected, find_variant(variants, arch, args.dpi, args.type))

    return selected


def parse_variants(soup: BeautifulSoup) -> list[dict[str, str]]:
    variants = []
    for row in soup.select(".variants-table .table-row"):
        cells = row.select(".table-cell")
        link = row.select_one("a[href*='apk-download']")
        if len(cells) < 4 or not link:
            continue

        first = cells[0].get_text(" ", strip=True)
        version = link.get_text(" ", strip=True) or first.split()[0]
        file_type = "bundle" if "BUNDLE" in first.upper() else "apk"
        version_code_match = re.search(r"\b\d{7,}\b", first)

        variants.append({
            "version": version,
            "type": file_type,
            "arch": cells[1].get_text(" ", strip=True),
            "minAndroidVersion": cells[2].get_text(" ", strip=True),
            "dpi": cells[3].get_text(" ", strip=True),
            "url": absolute_url(link.get("href")),
            "versionCode": version_code_match.group(0) if version_code_match else "",
        })

    return variants


def find_variant(variants: list[dict[str, str]], arch: str, dpi: str, file_type: str) -> dict[str, str] | None:
    arch = arch.lower()
    candidates = filter_variants(variants, dpi, file_type)

    if arch in {"universal", "noarch"}:
        preferred = [item for item in candidates if item["arch"].lower() in {"universal", "noarch"}]
        if preferred:
            return sorted(preferred, key=variant_sort_key)[0]
        return None

    exact = [item for item in candidates if arch_matches(item["arch"], arch)]
    if exact:
        return sorted(exact, key=lambda item: (arch_match_rank(item["arch"], arch), *variant_sort_key(item)))[0]

    universal = [item for item in candidates if item["arch"].lower() in {"universal", "noarch"}]
    return sorted(universal, key=variant_sort_key)[0] if universal else None


def filter_variants(variants: list[dict[str, str]], dpi: str, file_type: str) -> list[dict[str, str]]:
    candidates = [item for item in variants if item["type"] == file_type]
    if dpi not in {"*", "any"}:
        candidates = [item for item in candidates if dpi_matches(dpi, item["dpi"])]
    return candidates


def dpi_matches(requested: str, variant: str) -> bool:
    r = requested.lower().strip()
    v = variant.lower().strip()
    if r == v:
        return True
    if r in {"*", "any"} or v in {"*", "any"}:
        return True

    def parse_dpi_range(s: str):
        s = s.replace("dpi", "").strip()
        if "-" in s:
            parts = s.split("-")
            try:
                return int(parts[0]), int(parts[1])
            except ValueError:
                return None
        else:
            try:
                val = int(s)
                return val, val
            except ValueError:
                return None

    r_range = parse_dpi_range(r)
    v_range = parse_dpi_range(v)
    if r_range and v_range:
        r_min, r_max = r_range
        v_min, v_max = v_range
        return max(r_min, v_min) <= min(r_max, v_max)

    return False



def add_unique_variant(selected: list[dict[str, str]], variant: dict[str, str] | None) -> None:
    if not variant:
        return
    if any(item["url"] == variant["url"] for item in selected):
        return
    selected.append(variant)


def split_values(value: str) -> list[str]:
    return [item.strip().lower() for item in re.split(r"[,\s]+", value or "") if item.strip()]


def variant_sort_key(variant: dict[str, str]) -> tuple[float, int, str]:
    return (
        android_version_value(variant.get("minAndroidVersion", "")),
        dpi_specificity(variant.get("dpi", "")),
        variant.get("dpi", ""),
    )


def android_version_value(value: str) -> float:
    match = re.search(r"Android\s+(\d+(?:\.\d+)?)(L)?", value, re.IGNORECASE)
    if not match:
        return 999.0
    number = float(match.group(1))
    return number + (0.1 if match.group(2) else 0)


def dpi_specificity(value: str) -> int:
    normalized = value.lower()
    if normalized in {"nodpi", "universal"}:
        return 0
    if "-" in normalized:
        return 1
    return 2


def arch_matches(value: str, requested: str) -> bool:
    parts = arch_parts(value)
    return requested.lower() in parts


def arch_match_rank(value: str, requested: str) -> int:
    parts = arch_parts(value)
    requested = requested.lower()
    if len(parts) == 1 and parts[0] == requested:
        return 0
    if requested in parts:
        return 1
    return 2


def arch_parts(value: str) -> list[str]:
    return [part.strip().lower() for part in re.split(r"[,+]", value) if part.strip()]


def direct_download_button(soup: BeautifulSoup) -> str:
    button = soup.select_one("a.downloadButton[href*='/download/']")
    return absolute_url(button.get("href")) if button else ""


def resolve_download_url(variant_url: str) -> tuple[str, str]:
    variant_soup = soup_from_url(variant_url)
    first = direct_download_button(variant_soup)
    if not first:
        raise RuntimeError(f"Could not find APKMirror download button at {variant_url}")

    final_soup = soup_from_url(first, referer=variant_url)
    link = (
        final_soup.select_one(".card-with-tabs a[href*='download.php']")
        or final_soup.select_one("a[href*='download.php']")
    )
    if not link:
        raise RuntimeError(f"Could not find APKMirror final download link at {first}")

    download_php = absolute_url(link.get("href"))
    response = open_url(download_php, referer=first, accept="application/vnd.android.package-archive,*/*")
    try:
        return first, response.geturl()
    finally:
        response.close()


def soup_from_url(url: str, referer: str = "") -> BeautifulSoup:
    with open_url(url, referer=referer) as response:
        text = response.read().decode("utf-8", "ignore")
    if "Enable JavaScript and cookies to continue" in text or "Just a moment..." in text:
        raise RuntimeError("APKMirror returned a JavaScript/cookie challenge")
    return BeautifulSoup(text, "html.parser")


def open_url(url: str, referer: str = "", accept: str | None = None):
    headers = dict(HEADERS)
    if referer:
        headers["Referer"] = referer
    if accept:
        headers["Accept"] = accept

    try:
        return urlopen(Request(url, headers=headers), timeout=60)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore")
        detail = " JavaScript/cookie challenge" if "Enable JavaScript" in body or "Just a moment..." in body else ""
        raise RuntimeError(f"HTTP {exc.code} for {url}.{detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc.reason}") from exc


def absolute_url(value: str) -> str:
    return urljoin(BASE_URL, value)


def filename_from_url(url: str) -> str:
    path = unquote(urlparse(url).path)
    return Path(path).name


def format_bytes(bytes_count: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    value = float(bytes_count)
    unit = 0
    while value >= 1024 and unit < len(units) - 1:
        value /= 1024
        unit += 1
    return f"{value:.0f} {units[unit]}" if unit == 0 else f"{value:.1f} {units[unit]}"


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
