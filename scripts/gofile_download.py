#!/usr/bin/env python3

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError


PACKAGE_EXTENSIONS = (".apkm", ".xapk", ".apks", ".apk")
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)


async def main():
    parser = argparse.ArgumentParser(description="Download an APK package from a Gofile share page.")
    parser.add_argument("--url", required=True, help="Gofile share URL, for example https://gofile.io/d/abc123")
    parser.add_argument("--out-dir", required=True, help="Destination directory")
    parser.add_argument("--out-file", required=True, help="Preferred output file name")
    parser.add_argument("--password", default="", help="Optional Gofile folder password")
    parser.add_argument("--timeout", type=int, default=90, help="Browser wait timeout in seconds")
    args = parser.parse_args()

    try:
        result = await download_from_gofile(args)
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(json.dumps(result))
    return 0


async def download_from_gofile(args):
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        context = await browser.new_context(
            accept_downloads=True,
            locale="en-US",
            user_agent=USER_AGENT,
            viewport={"width": 1366, "height": 900},
        )
        page = await context.new_page()

        api_errors = []

        async def on_response(response):
            if "api.gofile.io/contents/" not in response.url:
                return
            try:
                body = await response.json()
            except Exception:
                body = None
            if response.status >= 400 or (isinstance(body, dict) and body.get("status") not in (None, "ok")):
                api_errors.append({
                    "status": response.status,
                    "url": response.url,
                    "body": body,
                })

        page.on("response", on_response)

        await page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout * 1000)
        if args.password:
            await fill_password_if_present(page, args.password)

        data = await wait_for_gofile_data(page, args.timeout)
        candidate = pick_package(data)
        if not candidate:
            names = ", ".join(item.get("name", "") for item in flatten_content(data)[:10])
            details = f" Files seen: {names}" if names else ""
            if api_errors:
                details += f" Last API error: {api_errors[-1]}"
            raise RuntimeError(f"No APK/APKM/XAPK/APKS file was exposed by the Gofile page.{details}")

        file_name = candidate.get("name") or basename_from_url(candidate["link"])
        extension = Path(file_name).suffix.lower()
        destination = out_dir / replace_extension(args.out_file, extension)

        cookies = await context.cookies()
        await browser.close()

    download_file(candidate["link"], destination, cookies)
    return {
        "path": str(destination.resolve()),
        "name": file_name,
        "source": "gofile-browser",
        "url": args.url,
    }


async def fill_password_if_present(page, password):
    selectors = [
        "input[type='password']",
        "input[name='password']",
        "#password",
    ]
    for selector in selectors:
        element = await page.query_selector(selector)
        if element:
            await element.fill(password)
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(1500)
            return


async def wait_for_gofile_data(page, timeout_seconds):
    deadline = timeout_seconds * 1000
    try:
        await page.wait_for_function(
            """() => {
                const data = window.appdata?.fileManager?.mainContent?.data;
                return data && (data.type === 'file' || data.children || data.name);
            }""",
            timeout=deadline,
        )
    except PlaywrightTimeoutError:
        body_text = await page.locator("body").inner_text(timeout=5000)
        raise RuntimeError(f"Gofile page did not expose file metadata. Page text: {body_text[:1000]}")

    return await page.evaluate("() => window.appdata.fileManager.mainContent.data")


def flatten_content(root):
    items = []

    def visit(node):
        if not isinstance(node, dict):
            return
        items.append(node)
        children = node.get("children")
        if isinstance(children, dict):
            for child in children.values():
                visit(child)
        elif isinstance(children, list):
            for child in children:
                visit(child)

    visit(root)
    return items


def pick_package(data):
    candidates = []
    for item in flatten_content(data):
        if item.get("type") != "file" or not item.get("link"):
            continue
        name = item.get("name") or item.get("link") or ""
        extension = Path(urlparse(name).path).suffix.lower()
        if extension in PACKAGE_EXTENSIONS:
            candidates.append(item)

    def rank(item):
        name = (item.get("name") or item.get("link") or "").lower()
        extension = Path(urlparse(name).path).suffix.lower()
        ext_rank = {".apkm": 0, ".xapk": 1, ".apks": 2, ".apk": 3}.get(extension, 9)
        name_rank = 0 if re.search(r"\b(twitter|x)\b", name) else 1
        return name_rank * 10 + ext_rank

    return sorted(candidates, key=rank)[0] if candidates else None


def download_file(url, destination, cookies):
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/vnd.android.package-archive,application/octet-stream,*/*",
        "Referer": "https://gofile.io/",
    })
    for cookie in cookies:
        domain = cookie.get("domain") or "gofile.io"
        session.cookies.set(cookie["name"], cookie["value"], domain=domain, path=cookie.get("path") or "/")

    with session.get(url, stream=True, timeout=60) as response:
        if response.status_code not in (200, 206):
            raise RuntimeError(f"File download failed with HTTP {response.status_code} for {url}")
        content_type = response.headers.get("content-type", "")
        if "text/html" in content_type.lower():
            raise RuntimeError(f"File download returned HTML instead of an APK package for {url}")
        with open(destination, "wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)


def basename_from_url(url):
    return Path(urlparse(url).path).name or "download.apk"


def replace_extension(file_name, extension):
    if extension not in PACKAGE_EXTENSIONS:
        extension = ".apk"
    return f"{Path(file_name).stem}{extension}"


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
