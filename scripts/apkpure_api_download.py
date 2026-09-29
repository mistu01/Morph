#!/usr/bin/env python3
"""Download an exact APKPure variant by version code.

The apkpure.com website is IP-blocked from datacenter IPs (GitHub runners get
403/Cloudflare challenges), and apkeep only grabs the first download URL listed
for a version. Two complementary channels still serve exact variants:

* The mobile catalog API (api.pureapk.com — same endpoint apkeep 1.0.0 uses)
  answers from datacenter IPs and embeds a signed download URL for EVERY
  variant of a version:  https://download.pureapk.com/b/APK/<base64>  where the
  base64 token decodes to `<packageName>_<versionCode>_<hash>` (verified
  2026-09-30 against com.facebook.orca).
* The d.apkpure.com/b/<TYPE>/<pkg>?versionCode=<code> mirror endpoint serves
  the exact variant when requested with a browser User-Agent (verified
  2026-09-30; the okhttp UA used in earlier CI runs got 403).

The catalog API is first queried to confirm the requested version code exists
(and to fail fast when APKPure dropped it), then the file is downloaded from
whichever endpoint/UA combination works and the APK manifest is checked for
the requested version code before the result is reported as JSON on stdout
(same shape as the other downloaders in scripts/).

Only the Python standard library is used so no CI dependency changes are
needed.
"""

import argparse
import base64
import json
import re
import struct
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

API_BASE = "https://api.pureapk.com/m/v3/cms/app_version"
MIRROR_URL_FORMAT = "https://d.apkpure.com/b/{file_type}/{package_name}?versionCode={version_code}"

API_HEADERS = {
    # Same headers apkeep 1.0.0 sends (src/download_sources/apkpure.rs).
    "x-cv": "3172501",
    "x-sv": "29",
    "x-gp": "1",
    "User-Agent": "okhttp/4.9.3",
}

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
OKHTTP_UA = "okhttp/4.9.3"

DOWNLOAD_URL_RE = re.compile(
    r"https://download\.pureapk\.com/b/(APK|XAPK)/([A-Za-z0-9+/=]+)"
)

TOKEN_CODE_RE = re.compile(r"^[A-Za-z0-9._]+_(\d{6,})_[0-9a-fA-F]+$")

MIN_APK_BYTES = 100_000


def api_headers_for(abis: str) -> dict:
    headers = dict(API_HEADERS)
    headers["x-abis"] = abis
    return headers


def fetch_catalog_once(package_name: str, abis: str) -> str:
    url = f"{API_BASE}?hl=en-US&package_name={urllib.parse.quote(package_name)}"
    request = urllib.request.Request(url, headers=api_headers_for(abis))
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.status != 200:
            raise RuntimeError(f"catalog API returned HTTP {response.status}")
        return response.read().decode("utf-8", "replace")


def fetch_catalog(package_name: str, abis: str, max_attempts: int = 3) -> str:
    """Fetch the catalog, retrying when a response carries no download URLs.

    The API intermittently serves a body without the download URL list (an
    empty/edge-cached variant), so an empty result must not be trusted.
    """
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            body = fetch_catalog_once(package_name, abis)
        except Exception as error:  # noqa: BLE001 - retry any transport failure
            last_error = error
        else:
            if DOWNLOAD_URL_RE.search(body):
                return body
            last_error = RuntimeError("catalog response contained no download URLs")
        print(
            f"Catalog attempt {attempt}/{max_attempts} was empty or failed: {last_error}",
            file=sys.stderr,
        )
        if attempt < max_attempts:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"catalog API failed after {max_attempts} attempts: {last_error}")


def decode_token(token: str) -> str:
    padded = token + "=" * (-len(token) % 4)
    return base64.b64decode(padded).decode("utf-8", "replace")


def catalog_variants(body: str) -> list[dict]:
    """Return every downloadable variant {code, fileType, url} in the catalog."""
    variants: list[dict] = []
    for file_type, token in DOWNLOAD_URL_RE.findall(body):
        decoded = decode_token(token)
        match = TOKEN_CODE_RE.match(decoded)
        if not match:
            continue
        variants.append({
            "code": match.group(1),
            "fileType": file_type,
            "url": f"https://download.pureapk.com/b/{file_type}/{token}",
        })
    return variants


def pick_variant(variants: list[dict], version_code: str) -> dict | None:
    for variant in variants:
        if variant["code"] == version_code:
            return variant
    return None


def content_disposition_filename(header: str) -> str | None:
    """Parse a Content-Disposition header, preferring RFC 5987 filename*."""
    if not header:
        return None
    extended = re.search(r"filename\*=(?:UTF-8|utf-8)''([^;]+)", header)
    if extended:
        return urllib.parse.unquote(extended.group(1).strip().strip('"'))
    plain = re.search(r'filename\s*=\s*"?([^";]+)"?', header)
    if plain:
        return plain.group(1).strip()
    return None


def verify_apk(path: Path, expected_code: int) -> tuple[bool, str]:
    """Check the file is a zip/APK whose manifest declares the expected code."""
    try:
        size = path.stat().st_size
        if size < MIN_APK_BYTES:
            return False, f"file is only {size} bytes (likely an HTML error page)"
        with zipfile.ZipFile(path) as bundle:
            # Messenger's binary manifest is ~380 KB, so scan the whole thing.
            manifest = bundle.read("AndroidManifest.xml")
            if struct.pack("<I", expected_code) not in manifest:
                return False, f"manifest does not contain version code {expected_code}"
    except zipfile.BadZipFile:
        return False, "not a valid zip/APK (likely an HTML error page)"
    except KeyError:
        return False, "APK has no AndroidManifest.xml"
    except Exception as error:  # noqa: BLE001 - cannot verify; let the patcher decide
        return True, f"could not verify manifest ({error})"
    return True, "manifest verified"


def download_file(url: str, user_agent: str, dest: Path, max_attempts: int = 2) -> Path:
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": user_agent})
            with urllib.request.urlopen(request, timeout=180) as response:
                if response.status != 200:
                    raise RuntimeError(f"download URL returned HTTP {response.status}")
                disposition = response.headers.get("content-disposition", "")
                name = content_disposition_filename(disposition)
                total = int(response.headers.get("content-length", "0") or 0)
                tmp_path = dest.with_suffix(dest.suffix + ".part")
                downloaded = 0
                with open(tmp_path, "wb") as handle:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        handle.write(chunk)
                        downloaded += len(chunk)
                if total and downloaded != total:
                    raise IOError(f"incomplete download: {downloaded}/{total} bytes")
                final = dest.with_name(name) if name else dest
                final.parent.mkdir(parents=True, exist_ok=True)
                if final.exists():
                    final.unlink()
                tmp_path.replace(final)
                return final
        except Exception as error:  # noqa: BLE001 - retry any transport failure
            last_error = error
            print(f"Attempt {attempt}/{max_attempts} failed: {error}", file=sys.stderr)
            if attempt < max_attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"download failed after {max_attempts} attempts: {last_error}")


def download_exact(
    variant: dict,
    package_name: str,
    out_dir: Path,
    expected_code: int,
    max_attempts: int = 2,
) -> Path:
    """Download the exact variant, trying the CDN URL and the mirror endpoint.

    Different endpoints and User-Agents work from different networks: the CDN
    token URL serves APKs to datacenter IPs while rejecting browser UAs with an
    HTML redirect, and the d.apkpure.com mirror serves browser UAs while
    rejecting okhttp ones. Try every combination and verify the result; an
    already-verified file from an earlier attempt/run is reused as-is.
    """
    mirror_url = MIRROR_URL_FORMAT.format(
        file_type=variant["fileType"],
        package_name=urllib.parse.quote(package_name),
        version_code=variant["code"],
    )
    endpoints = [
        ("cdn", variant["url"]),
        ("mirror", mirror_url),
    ]
    failures: list[str] = []
    dest = out_dir / f"{package_name}_{variant['code']}.apk"
    if dest.exists():
        ok, reason = verify_apk(dest, expected_code)
        if ok:
            print(f"Reusing previously verified download: {dest} ({reason}).", file=sys.stderr)
            return dest
    for label, url in endpoints:
        for ua_label, user_agent in (("browser", BROWSER_UA), ("okhttp", OKHTTP_UA)):
            for attempt in range(1, max_attempts + 1):
                try:
                    path = download_file(url, user_agent, dest)
                except Exception as error:  # noqa: BLE001
                    failures.append(f"{label}/{ua_label} #{attempt}: {error}")
                    continue
                ok, reason = verify_apk(path, expected_code)
                if ok:
                    print(
                        f"Downloaded variant {variant['code']} via {label}/{ua_label} "
                        f"({reason}).",
                        file=sys.stderr,
                    )
                    if path != dest and dest.exists():
                        dest.unlink()  # drop stale/partial data from earlier attempts
                    return path
                failures.append(f"{label}/{ua_label} #{attempt}: {reason}")
                print(
                    f"{label}/{ua_label} attempt {attempt} produced an unusable file: {reason}",
                    file=sys.stderr,
                )
    raise RuntimeError("all download endpoint combinations failed: " + "; ".join(failures))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-name", required=True)
    parser.add_argument("--package-name", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--version", default="")
    parser.add_argument("--version-code", required=True, help="exact variant version code to download")
    parser.add_argument(
        "--abis",
        default="arm64-v8a,armeabi-v7a,x86_64",
        help="x-abis header value sent to the catalog API",
    )
    parser.add_argument(
        "--expect-arch",
        default="",
        help="warn if the downloaded APK lacks lib/<arch>/ entries (informational)",
    )
    parser.add_argument(
        "--skip-catalog-check",
        action="store_true",
        help="download from the mirror endpoint without querying the catalog API first",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    variant: dict | None = None
    if not args.skip_catalog_check:
        print(f"Querying APKPure catalog API for {args.package_name}...", file=sys.stderr)
        try:
            body = fetch_catalog(args.package_name, args.abis)
        except Exception as error:  # noqa: BLE001
            print(
                f"{args.app_name}: APKPure catalog API request failed ({error}); "
                "falling back to the mirror endpoint.",
                file=sys.stderr,
            )
        else:
            variants = catalog_variants(body)
            print(f"Catalog lists {len(variants)} downloadable variants.", file=sys.stderr)
            variant = pick_variant(variants, args.version_code)
            if variant is None:
                codes = sorted({v["code"] for v in variants})
                nearby = [c for c in codes if c[:5] == args.version_code[:5]]
                print(
                    f"{args.app_name}: APKPure catalog has no variant with version code "
                    f"{args.version_code}. Codes sharing its prefix: {', '.join(nearby) or 'none'}.",
                    file=sys.stderr,
                )
                return 2
    if variant is None:
        variant = {
            "code": args.version_code,
            "fileType": "APK",
            "url": "",
        }

    print(
        f"Downloading variant {variant['code']} ({variant['fileType']}) "
        f"for {args.version or 'requested version'}...",
        file=sys.stderr,
    )
    try:
        path = download_exact(variant, args.package_name, out_dir, int(variant["code"]))
    except Exception as error:  # noqa: BLE001
        print(f"{args.app_name}: download failed: {error}", file=sys.stderr)
        return 3

    if not path.exists() or path.stat().st_size == 0:
        print(f"{args.app_name}: downloaded file is missing or empty: {path}", file=sys.stderr)
        return 4

    if args.expect_arch:
        try:
            with zipfile.ZipFile(path) as bundle:
                names = bundle.namelist()
            prefix = f"lib/{args.expect_arch}/"
            if not any(name.startswith(prefix) for name in names):
                print(
                    f"{args.app_name}: warning: APK has no {args.expect_arch} libraries; "
                    "it may be the wrong architecture.",
                    file=sys.stderr,
                )
        except Exception:  # noqa: BLE001 - informational only
            pass

    print(json.dumps({
        "appName": args.app_name,
        "packageName": args.package_name,
        "downloadUrl": variant["url"],
        "path": str(path),
        "filename": path.name,
        "requestedVersionCode": args.version_code,
        "versionCode": variant["code"],
        "version": args.version,
        "fileType": variant["fileType"],
        "source": "apkpure-exact-code",
    }))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
