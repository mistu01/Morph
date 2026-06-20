#!/usr/bin/env python3

import argparse
import contextlib
import json
import os
import sys
import time
import re
import urllib.parse as urlparse
from pathlib import Path

from apkpure.apkpure import ApkPure
from bs4 import BeautifulSoup
import requests
import cloudscraper
from tqdm import tqdm


def robust_downloader(api, url, out_dir):
    headers = api.headers.copy()
    max_retries = 5
    
    scraper = cloudscraper.create_scraper()
    
    print(f"Requesting download URL: {url}", file=sys.stderr)
    response = scraper.get(url, headers=headers, stream=True, allow_redirects=True)
    if response.status_code != 200:
        raise RuntimeError(f"Failed to connect to download URL, status code: {response.status_code}")
        
    d = response.headers.get("content-disposition")
    if d:
        matches = re.findall(r'filename=(.+)', d)
        if matches:
            fname = matches[0].strip('"')
        else:
            fname = "downloaded_file.apk"
    else:
        fname = "downloaded_file.apk"
        
    dest_path = os.path.realpath(os.path.join(out_dir, "apks", fname))
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    
    total_size = int(response.headers.get("content-length", 0))
    print(f"Total size: {total_size} bytes, saving to {dest_path}", file=sys.stderr)
    
    if os.path.exists(dest_path) and os.path.getsize(dest_path) == total_size:
        print("File already exists with correct size!", file=sys.stderr)
        return dest_path
        
    downloaded_size = 0
    mode = "wb"
    
    for attempt in range(1, max_retries + 1):
        try:
            if attempt > 1:
                if os.path.exists(dest_path):
                    downloaded_size = os.path.getsize(dest_path)
                    if downloaded_size < total_size:
                        headers["Range"] = f"bytes={downloaded_size}-"
                        mode = "ab"
                        print(f"Attempt {attempt}/{max_retries}: Resuming from byte {downloaded_size}...", file=sys.stderr)
                        response = scraper.get(url, headers=headers, stream=True, allow_redirects=True)
                        if response.status_code != 206:
                            print("Server does not support range requests. Restarting download...", file=sys.stderr)
                            downloaded_size = 0
                            mode = "wb"
                            headers.pop("Range", None)
                            response = scraper.get(url, headers=headers, stream=True, allow_redirects=True)
                    else:
                        print("File downloaded completely!", file=sys.stderr)
                        return dest_path
                else:
                    downloaded_size = 0
                    mode = "wb"
                    headers.pop("Range", None)
                    response = scraper.get(url, headers=headers, stream=True, allow_redirects=True)
            
            if response.status_code not in (200, 206):
                raise IOError(f"Bad status code from server: {response.status_code}")
                
            with open(dest_path, mode) as f:
                with tqdm(total=total_size, initial=downloaded_size, unit="B", unit_scale=True, desc=fname, file=sys.stderr) as pbar:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            f.write(chunk)
                            pbar.update(len(chunk))
                            downloaded_size += len(chunk)
            
            actual_size = os.path.getsize(dest_path)
            if actual_size == total_size:
                print("Download completed successfully!", file=sys.stderr)
                return dest_path
            else:
                raise IOError(f"Incomplete download: got {actual_size} bytes, expected {total_size}")
                
        except Exception as e:
            print(f"Attempt {attempt} failed: {e}", file=sys.stderr)
            if attempt == max_retries:
                raise e
            time.sleep(2 ** attempt)
            
    return dest_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Download APKPure APKs using the apkpure Python package.")
    parser.add_argument("--app-name", required=True)
    parser.add_argument("--package-name", required=True)
    parser.add_argument("--source-page", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--version", default="")
    parser.add_argument("--arch", default="")
    args = parser.parse_args()

    api = ApkPure()
    versions = get_versions(api, args.source_page)
    selected = select_version(versions, args.version)
    if not selected:
        available = ", ".join(item["version"] for item in versions[:20])
        requested = args.version or "latest"
        print(f"{args.app_name}: APKPure version {requested} was not found. Available sample: {available or 'none'}", file=sys.stderr)
        return 2

    # If architecture is requested, try to resolve the specific variant version code from the download page
    if args.arch and selected.get("download_link"):
        try:
            print(f"Resolving variant for arch '{args.arch}' from: {selected['download_link']}", file=sys.stderr)
            resp = api.get_response(url=selected["download_link"])
            if resp:
                soup = BeautifulSoup(resp.text, "html.parser")
                normalized_arch = args.arch.lower().replace('_', '-')
                found_code = None
                for el in soup.find_all("a"):
                    href = el.get("href") or ""
                    if "versionCode=" in href:
                        parent_text = el.parent.text.strip().lower().replace('_', '-')
                        if normalized_arch in parent_text:
                            parsed = urlparse.urlparse(href)
                            params = urlparse.parse_qs(parsed.query)
                            codes = params.get("versionCode")
                            if codes:
                                found_code = codes[0]
                                print(f"Found matching arch variant: {el.parent.text.strip().replace('\n', ' ')}", file=sys.stderr)
                                break
                if found_code:
                    selected["version_code"] = found_code
                    print(f"Using variant version code: {found_code}", file=sys.stderr)
                else:
                    print(f"No variant found matching arch '{args.arch}'. Using default version code.", file=sys.stderr)
        except Exception as e:
            print(f"Error resolving variant: {e}", file=sys.stderr)

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    download_url = f"https://d.apkpure.com/b/{selected['file_type']}/{args.package_name}?versionCode={selected['version_code']}"

    try:
        downloaded = robust_downloader(api, download_url, out_dir)
    except Exception as e:
        print(f"Error downloading: {e}", file=sys.stderr)
        downloaded = None

    if not downloaded:
        print(f"{args.app_name}: apkpure returned no downloaded file for {selected['version']}", file=sys.stderr)
        return 3

    path = Path(downloaded).resolve()
    if not path.exists():
        print(f"{args.app_name}: downloaded file is missing: {path}", file=sys.stderr)
        return 4

    print(json.dumps({
        "appName": args.app_name,
        "packageName": args.package_name,
        "sourcePage": args.source_page,
        "downloadPage": selected.get("download_link", ""),
        "downloadUrl": download_url,
        "path": str(path),
        "filename": path.name,
        "version": selected["version"],
        "versionCode": selected["version_code"],
        "fileType": selected["file_type"],
        "availableVersions": [item["version"] for item in versions],
    }))
    return 0


def get_versions(api: ApkPure, source_page: str) -> list[dict[str, str]]:
    versions_url = f"{source_page.rstrip('/')}/versions"
    response = api.get_response(url=versions_url)
    if response is None:
        raise RuntimeError(f"APKPure versions request failed for {versions_url}")

    soup = BeautifulSoup(response.text, "html.parser")
    versions: list[dict[str, str]] = []
    seen: set[str] = set()

    for element in soup.select("[data-dt-version][data-dt-versioncode]"):
        version = (element.get("data-dt-version") or "").strip()
        version_code = (element.get("data-dt-versioncode") or "").strip()
        apk_id = (element.get("data-dt-apkid") or element.get("data-dt-apklist") or "").strip()
        file_type = apk_id.split("/")[1] if apk_id.startswith("b/") and len(apk_id.split("/")) > 1 else "APK"
        if not version or not version_code or version in seen:
            continue

        link = ""
        if element.name == "a":
            link = element.get("href") or ""
        if not link:
            nested = element.find("a", href=True)
            link = nested.get("href") if nested else ""

        versions.append({
            "version": version,
            "version_code": version_code,
            "file_type": file_type,
            "download_link": link,
        })
        seen.add(version)

    return versions


def select_version(versions: list[dict[str, str]], requested: str) -> dict[str, str] | None:
    import re
    if not versions:
        return None
    if not requested or requested == "latest":
        return versions[0]
    
    # Exact match first
    for item in versions:
        if item["version"].strip().lower() == requested.strip().lower():
            return item

    # Normalized match helper
    def clean(v: str) -> str:
        v = v.lower().strip()
        v = re.sub(r'[-_]', '.', v)
        v = re.sub(r'\b(release|stable|beta|alpha|ripped|prod|final|android)\b', '', v)
        v = re.sub(r'\.+', '.', v)
        v = v.strip('.')
        return v

    clean_requested = clean(requested)
    
    # Check normalized matches
    for item in versions:
        if clean(item["version"]) == clean_requested:
            return item

    # Base version match (first 3 digit parts)
    req_parts = [p for p in clean_requested.split('.') if p.isdigit()]
    if req_parts:
        for item in versions:
            item_parts = [p for p in clean(item["version"]).split('.') if p.isdigit()]
            if item_parts:
                min_len = min(len(req_parts), len(item_parts))
                if min_len >= 3 and req_parts[:3] == item_parts[:3]:
                    return item
                if min_len >= 2 and req_parts[:min_len] == item_parts[:min_len]:
                    return item

    return None



if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
