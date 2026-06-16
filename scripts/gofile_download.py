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
    parser.add_argument("--debug-dir", default=".cache/gofile-debug", help="Directory for debug artifacts")
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
    debug_dir = Path(args.debug_dir)
    debug_dir.mkdir(parents=True, exist_ok=True)

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

        await page.wait_for_timeout(5000)
        data = await get_gofile_data(page, args.timeout)
        await write_debug_artifacts(page, debug_dir, data, api_errors)

        candidate = pick_package(data) if data else None
        if not candidate:
            candidate = await pick_dom_link(page)
        if not candidate:
            download = await try_playwright_download(page, out_dir, args.out_file, debug_dir)
            if download:
                await browser.close()
                return download

            names = ", ".join(item.get("name", "") for item in flatten_content(data or {})[:10])
            details = f" Files seen: {names}" if names else ""
            if api_errors:
                details += f" Last API error: {api_errors[-1]}"
            raise RuntimeError(
                f"No APK/APKM/XAPK/APKS file was exposed by the Gofile page.{details} "
                f"Debug artifacts written to {debug_dir.resolve()}"
            )

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


async def get_gofile_data(page, timeout_seconds):
    try:
        await page.wait_for_function(
            """() => {
                const data = window.appdata?.fileManager?.mainContent?.data;
                return data && (data.type === 'file' || data.children || data.name);
            }""",
            timeout=timeout_seconds * 1000,
        )
    except PlaywrightTimeoutError:
        return None

    return await page.evaluate("() => window.appdata.fileManager.mainContent.data")


async def write_debug_artifacts(page, debug_dir, data, api_errors):
    try:
        (debug_dir / "gofile-appdata.json").write_text(json.dumps(data or {}, indent=2), encoding="utf-8")
        (debug_dir / "gofile-api-errors.json").write_text(json.dumps(api_errors, indent=2), encoding="utf-8")
        body_text = await page.locator("body").inner_text(timeout=5000)
        (debug_dir / "gofile-body.txt").write_text(body_text[:20000], encoding="utf-8")
        dom = await page.content()
        (debug_dir / "gofile-page.html").write_text(dom[:200000], encoding="utf-8")
        await page.screenshot(path=str(debug_dir / "gofile-page.png"), full_page=True)
    except Exception as error:
        (debug_dir / "gofile-debug-error.txt").write_text(str(error), encoding="utf-8")


async def pick_dom_link(page):
    links = await page.evaluate(
        """() => [...document.querySelectorAll('a[href]')].map((a) => ({
            name: a.innerText || a.getAttribute('download') || a.href,
            link: a.href,
            type: 'file'
        }))"""
    )
    candidates = [
        link for link in links
        if Path(urlparse(link.get("name") or link.get("link") or "").path).suffix.lower() in PACKAGE_EXTENSIONS
        or Path(urlparse(link.get("link") or "").path).suffix.lower() in PACKAGE_EXTENSIONS
    ]
    if not candidates:
        return None
    return sorted(candidates, key=lambda item: package_rank(item.get("name") or item.get("link") or ""))[0]


async def try_playwright_download(page, out_dir, out_file, debug_dir):
    elements = await page.evaluate(
        """() => [...document.querySelectorAll('a,button,[role="button"]')].map((el, index) => {
            const row = el.closest('[data-item-id], .item, tr, li, div');
            return {
                index,
                text: el.innerText || '',
                href: el.href || '',
                className: String(el.className || ''),
                aria: el.getAttribute('aria-label') || '',
                title: el.getAttribute('title') || '',
                rowText: row?.innerText || ''
            };
        })"""
    )
    (debug_dir / "gofile-click-candidates.json").write_text(json.dumps(elements, indent=2), encoding="utf-8")

    def looks_downloadable(item):
        haystack = " ".join(str(item.get(key, "")) for key in ("text", "href", "className", "aria", "title", "rowText")).lower()
        if "download" not in haystack:
            return False
        row = (item.get("rowText") or item.get("href") or "").lower()
        return any(ext in row for ext in PACKAGE_EXTENSIONS) or len(elements) <= 10

    for item in [element for element in elements if looks_downloadable(element)][:8]:
        locator = page.locator('a,button,[role="button"]').nth(item["index"])
        try:
            async with page.expect_download(timeout=20000) as download_info:
                await locator.click(timeout=5000, force=True)
            download = await download_info.value
            suggested = download.suggested_filename or replace_extension(out_file, ".apk")
            extension = Path(suggested).suffix.lower()
            if extension not in PACKAGE_EXTENSIONS:
                await download.cancel()
                continue
            destination = out_dir / replace_extension(out_file, extension)
            await download.save_as(str(destination))
            return {
                "path": str(destination.resolve()),
                "name": suggested,
                "source": "gofile-browser-click",
            }
        except Exception:
            continue

    return None


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

    return sorted(candidates, key=lambda item: package_rank(item.get("name") or item.get("link") or ""))[0] if candidates else None


def package_rank(name):
    lowered = name.lower()
    extension = Path(urlparse(lowered).path).suffix.lower()
    ext_rank = {".apkm": 0, ".xapk": 1, ".apks": 2, ".apk": 3}.get(extension, 9)
    name_rank = 0 if re.search(r"\b(twitter|x)\b", lowered) else 1
    return name_rank * 10 + ext_rank


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
