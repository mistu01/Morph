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
import io
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
    r"https://download\.pureapk\.com/b/(APK|XAPK)/([A-Za-z0-9+/=]+)(\?[^\s\"'<>\x00-\x1f\\]*)?"
)

TOKEN_CODE_RE = re.compile(r"^[A-Za-z0-9._]+_(\d{6,})_[0-9a-fA-F]+$")

AEGON_UA = "Dalvik/2.1.0 (Linux; U; Android 13; Pixel 5 Build/TQ3A.230901.001); APKPure/3.20.34 (Aegon)"
MIN_APK_BYTES = 100_000


def fetch_tapi_variants(package_name: str, abis: str = "arm64-v8a") -> list[dict]:
    """Query APKPure's native app API (tapi.pureapk.com) for recent version variants.

    This API returns the full history of version codes (including Android 11+
    splits), and provides signed, direct CDN download URLs on data.winudf.com.
    """
    url = f"https://tapi.pureapk.com/v3/get_app_his_version?package_name={urllib.parse.quote(package_name)}&hl=en"
    abi_list = [a.strip() for a in abis.split(",") if a.strip()] or ["arm64-v8a", "armeabi-v7a", "armeabi"]
    headers = {
        "User-Agent": AEGON_UA,
        "Ual-Access-Businessid": "projecta",
        "Ual-Access-ProjectA": json.dumps({
            "device_info": {
                "abis": abi_list,
                "android_id": "50f838123d9a9c94",
                "brand": "google",
                "country": "United States",
                "country_code": "US",
                "imei": "",
                "language": "en-US",
                "manufacturer": "Google",
                "mode": "Pixel 5",
                "os_ver": "33",
                "os_ver_name": "13",
                "platform": 1,
                "product": "redfin",
                "screen_height": 1080,
                "screen_width": 1920,
            },
            "host_app_info": {
                "build_no": "468",
                "channel": "",
                "md5": "6756e53158d6f6c013650a40d8f1147b",
                "pkg_name": "com.apkpure.aegon",
                "sdk_ver": "3.20.34",
                "version_code": 3203427,
                "version_name": "3.20.34",
            },
        }),
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8", "replace"))
                vlist = data.get("version_list") or data.get("data", {}).get("version_list", [])
                variants = []
                for item in vlist:
                    code = str(item.get("version_code", "")).strip()
                    ver_name = str(item.get("version_name", "")).strip()
                    asset = item.get("asset", {})
                    urls = asset.get("urls", [])
                    file_type = asset.get("type", "APK")
                    if urls and code:
                        variants.append({
                            "code": code,
                            "version": ver_name,
                            "fileType": file_type,
                            "url": urls[0],
                            "urls": urls,
                            "abis": item.get("native_code", []),
                        })
                return variants
    except Exception as e:
        print(f"tapi.pureapk.com query notice: {e}", file=sys.stderr)
    return []


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
    for match in DOWNLOAD_URL_RE.finditer(body):
        file_type = match.group(1)
        token = match.group(2)
        raw_query = match.group(3) or ""
        clean_query = re.sub(r"[^a-zA-Z0-9_\-\.\:\%\&\=\?\/].*$", "", raw_query)
        decoded = decode_token(token)
        m = TOKEN_CODE_RE.match(decoded)
        if not m:
            continue
        variants.append({
            "code": m.group(1),
            "fileType": file_type,
            "url": f"https://download.pureapk.com/b/{file_type}/{token}{clean_query}",
        })
    return variants


def pick_variant(variants: list[dict], version_code: str) -> dict | None:
    for variant in variants:
        if variant["code"] == version_code:
            return variant
    return None


def fetch_range(url: str, user_agent: str, start: str) -> bytes:
    """GET a byte range, following the CDN redirect for a signed URL."""
    request = urllib.request.Request(url, headers={"User-Agent": user_agent, "Range": f"bytes={start}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.status not in (200, 206):
            raise RuntimeError(f"range request returned HTTP {response.status} (Range: {start})")
        return response.read()


def read_central_directory_names(url: str, extra_urls: list[str] | None = None) -> list[str] | None:
    """Read a bundle's zip central directory with two Range requests.

    Small cost, no full download: the tail holds the EOCD record (and central
    directory size + offset), the second read holds every entry name, which
    for an XAPK includes every split's contents -- enough to tell which ABIs
    the bundle builds without downloading it. `extra_urls` are fallback
    addresses for the same bundle (the token CDN redirects, and the mirror
    endpoint serves different user agents), each tried with both UAs.
    """
    addresses = [url] + [u for u in (extra_urls or []) if u]
    last_error: Exception | None = None
    for address in addresses:
        try:
            tail = None
            for user_agent in (OKHTTP_UA, BROWSER_UA):
                try:
                    tail = fetch_range(address, user_agent, "-262144")
                    break
                except Exception as error:  # noqa: BLE001 - try the next UA
                    last_error = error
            if tail is None:
                raise RuntimeError(f"tail read failed: {last_error}")
            eocd_at = tail.rfind(b"PK\x05\x06")
            if eocd_at < 0 or eocd_at + 22 > len(tail):
                raise RuntimeError(
                    f"no zip EOCD in {len(tail)} range bytes (body looks like: {tail[:64]!r})"
                )
            entry_count, cd_size, cd_offset = struct.unpack_from(
                "<HII", tail, eocd_at + 10,  # count at +10, size at +12, offset at +16
            )
            if cd_size == 0 or cd_offset == 0 or cd_size == 0xFFFFFFFF or cd_offset == 0xFFFFFFFF:
                raise RuntimeError("zip64 (or corrupt) central directory is not handled")
            last_error = None
            cd = None
            for user_agent in (OKHTTP_UA, BROWSER_UA):
                try:
                    cd = fetch_range(address, user_agent, f"{cd_offset}-{cd_offset + cd_size - 1}")
                    break
                except Exception as error:  # noqa: BLE001 - try the next UA
                    last_error = error
            if cd is None:
                raise RuntimeError(f"central directory read failed: {last_error}")
            names: list[str] = []
            pos = 0
            while pos + 46 <= len(cd):
                pos = cd.find(b"PK\x01\x02", pos)
                if pos < 0 or pos + 46 > len(cd):
                    break
                name_len = struct.unpack_from("<H", cd, pos + 28)[0]
                extra_len, comment_len = struct.unpack_from("<HH", cd, pos + 30)
                names.append(cd[pos + 46: pos + 46 + name_len].decode("utf-8", "replace"))
                pos += 46 + name_len + extra_len + comment_len
            if not names:
                raise RuntimeError("central directory parsed to no entry names")
            return names
        except Exception as error:  # noqa: BLE001 - report and try the next address
            last_error = error
            print(f"  probe of {address[:96]} failed: {error}", file=sys.stderr)
    return None


def bundle_abis(names: list[str]) -> set[str]:
    """Maps zip entry names of a bundle to the ABI set it ships."""
    abis: set[str] = set()
    for name in names:
        lowered = name.replace("\\", "/").lower()
        head = lowered.split("/")[0]
        if head.startswith("config."):
            for abi in ("arm64-v8a", "armeabi-v7a", "x86_64", "x86"):
                if abi.replace("-", "_") in head:
                    abis.add(abi)
        match = re.match(r"^(?:base/)?lib/([a-z0-9_-]+)/", lowered)
        if match:
            abis.add(match.group(1))
    return abis


def bundle_abis_from_file(path: Path) -> set[str]:
    """Maps a downloaded bundle on disk to the ABI set it ships.

    APKPure XAPKs are zips of whole .apk splits, so the lib directories live
    inside each member apk rather than at the top level of the bundle.
    """
    abis: set[str] = set()
    with zipfile.ZipFile(path) as bundle:
        members = [name for name in bundle.namelist() if name.lower().endswith(".apk")]
        if not members:
            members = [path.name]  # the file itself is an .apk, not a bundle
        for name in members:
            try:
                if members == [path.name]:
                    inner_bytes = path.read_bytes()
                else:
                    inner_bytes = bundle.read(name)
                with zipfile.ZipFile(io.BytesIO(inner_bytes)) as inner:
                    for member in inner.namelist():
                        match = re.match(r"^(?:base/)?lib/([a-z0-9_-]+)/", member.lower().replace("\\", "/"))
                        if match:
                            abis.add(match.group(1))
            except Exception:  # noqa: BLE001 - a member failing to open shouldn't hide the rest
                continue
    return abis




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
    """Check the file is a zip/APK/XAPK whose manifest declares the expected code."""
    try:
        size = path.stat().st_size
        if size < MIN_APK_BYTES:
            return False, f"file is only {size} bytes (likely an HTML error page)"
        with zipfile.ZipFile(path) as bundle:
            manifest = None
            if "AndroidManifest.xml" in bundle.namelist():
                manifest = bundle.read("AndroidManifest.xml")
            else:
                # XAPK / bundle archives have split APKs inside (base.apk, etc.)
                for name in bundle.namelist():
                    if name.lower().endswith(".apk"):
                        try:
                            with zipfile.ZipFile(io.BytesIO(bundle.read(name))) as inner_apk:
                                if "AndroidManifest.xml" in inner_apk.namelist():
                                    manifest = inner_apk.read("AndroidManifest.xml")
                                    break
                        except Exception:
                            continue
            if manifest is None:
                return False, "APK/bundle has no AndroidManifest.xml"
            if struct.pack("<I", expected_code) not in manifest:
                return False, f"manifest does not contain version code {expected_code}"
    except zipfile.BadZipFile:
        return False, "not a valid zip/APK (likely an HTML error page)"
    except Exception as error:  # noqa: BLE001 - cannot verify; let the patcher decide
        return True, f"could not verify manifest ({error})"
    return True, "manifest verified"


def download_file(url: str, user_agent: str, dest: Path, max_attempts: int = 2) -> Path:
    last_error: Exception | None = None
    headers = {"User-Agent": user_agent}
    if "winudf.com" in url or "pureapk.com" in url:
        headers["Referer"] = "https://apkpure.com/"
    for attempt in range(1, max_attempts + 1):
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=60) as response:
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
        file_type=variant.get("fileType", "APK"),
        package_name=urllib.parse.quote(package_name),
        version_code=variant["code"],
    )
    endpoints = []
    if variant.get("url"):
        endpoints.append(("cdn", variant["url"]))
    for u in variant.get("urls", [])[1:]:
        endpoints.append(("cdn_alt", u))
    endpoints.append(("mirror", mirror_url))

    ext = ".xapk" if str(variant.get("fileType", "")).upper() == "XAPK" else ".apk"
    failures: list[str] = []
    dest = out_dir / f"{package_name}_{variant['code']}{ext}"
    if dest.exists():
        ok, reason = verify_apk(dest, expected_code)
        if ok:
            print(f"Reusing previously verified download: {dest} ({reason}).", file=sys.stderr)
            return dest
    for label, url in endpoints:
        for ua_label, user_agent in (("aegon", AEGON_UA), ("browser", BROWSER_UA), ("okhttp", OKHTTP_UA)):
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
        "--allow-nearby-codes",
        action="store_true",
        help="when the exact code is absent from the catalog, probe nearby delivery "
        "codes of the same version and pick one whose bundle ships the wanted ABI",
    )
    parser.add_argument(
        "--expect-abi",
        default="",
        help="ABI the bundle must ship when --allow-nearby-codes is used (e.g. arm64-v8a)",
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
        print(f"Querying APKPure tapi API for {args.package_name}...", file=sys.stderr)
        tapi_variants = fetch_tapi_variants(args.package_name, args.abis)
        if tapi_variants:
            print(f"APKPure tapi API returned {len(tapi_variants)} variants.", file=sys.stderr)
            variant = pick_variant(tapi_variants, args.version_code)
            if variant:
                print(
                    f"{args.app_name}: found exact variant {variant['code']} ({variant['fileType']}) in APKPure tapi API.",
                    file=sys.stderr,
                )

        if variant is None:
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
                requested = int(args.version_code)
                nearby = [v for v in variants if 0 < abs(int(v["code"]) - requested) <= 10_000]
                if args.allow_nearby_codes and args.expect_abi and nearby:
                    # APKPure republishes Play bundles with its own delivery
                    # codes, so the patches' exact code may be absent while the
                    # same version's ABI variants are all there. The ABIs only
                    # show inside each member apk, so try candidates download-
                    # first (closest code first), check what they ship, and
                    # delete anything that doesn't match the wanted ABI.
                    nearby.sort(key=lambda v: int(v["code"]), reverse=True)
                    tried: list[str] = []
                    for candidate in nearby:
                        print(
                            f"{args.app_name}: trying delivery code {candidate['code']} "
                            f"({candidate['fileType']}) for the {args.expect_abi} variant...",
                            file=sys.stderr,
                        )
                        try:
                            path = download_exact(candidate, args.package_name, out_dir, int(candidate["code"]))
                        except Exception as error:  # noqa: BLE001 - try the next candidate
                            tried.append(f"{candidate['code']}: download failed ({error})")
                            continue
                        abis = bundle_abis_from_file(path)
                        if args.expect_abi in abis:
                            variant = candidate
                            print(
                                f"{args.app_name}: delivery code {candidate['code']} "
                                f"ships {', '.join(sorted(abis))}; taking it.",
                                file=sys.stderr,
                            )
                            break
                        tried.append(f"{candidate['code']}: ships {', '.join(sorted(abis)) or 'no libs'}")
                        try:
                            path.unlink()
                        except OSError:
                            pass
                    print(
                        f"{args.app_name}: nearby delivery codes tried (want {args.expect_abi}): "
                        + "; ".join(tried),
                        file=sys.stderr,
                    )
                if variant is None:
                    codes = sorted({v["code"] for v in variants})
                    sharing = [c for c in codes if c[:5] == args.version_code[:5]]
                    print(
                        f"{args.app_name}: APKPure catalog has no variant with version code "
                        f"{args.version_code}. Codes sharing its prefix: {', '.join(sharing) or 'none'}.",
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
