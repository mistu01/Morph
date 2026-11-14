#!/usr/bin/env python3
"""Download the exact Facebook build Hushfacebook documents, from Uptodown.

Usage: fetch_uptodown.py <version> <outdir>
"""
import json
import os
import re
import sys
import time
import urllib.request

UT_BASE = "https://facebook.en.uptodown.com/android"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/156.0.0.0 Safari/537.36")
UA_FETCH = ("Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 "
            "Firefox/135.0")

STEALTH = r"""
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
if (!window.chrome) {
  window.chrome = {runtime: {}, loadTimes: () => ({}), csi: () => ({})};
}
Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
const _pq = window.navigator.permissions.query.bind(window.navigator.permissions);
window.navigator.permissions.query = (params) =>
  params.name === 'notifications'
    ? Promise.resolve({state: Notification.permission})
    : _pq(params);
const _gp = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function (p) {
  if (p === 37445) return 'Google Inc. (X.org)';
  if (p === 37446) return 'ANGLE (X.org, Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5 (Core Profile) Mesa 23.2.1)';
  return _gp.call(this, p);
};
"""


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def pick_file_id(version):
    html = None
    last_err = None
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(
                UT_BASE + "/versions",
                headers={"User-Agent": UA_FETCH, "Referer": "https://en.uptodown.com/"}
            )
            resp = urllib.request.urlopen(req, timeout=30)
            html = resp.read().decode("utf-8", "replace")
            break
        except Exception as e:
            last_err = e
            log(f"::warning::/versions fetch attempt {attempt} failed: {e}")
            time.sleep(5 * attempt)
    if html is None:
        log(f"::error::Could not load Uptodown version history: {last_err}")
        return None, None
    rows = re.findall(
        r'data-version-id="(\d+)"[^>]*>\s*'
        r'<span class="type[^"]*"[^>]*>[^<]*</span>\s*'
        r'<span class="version">([^<]+)</span>\s*'
        r'<span class="sdkVersion">([^<]+)</span>',
        html
    )
    if not rows:
        return None, None
    for fid, ver, sdk in rows:
        if ver == version and "+ 11" in sdk:
            return fid, sdk
    log(f"::warning::no Android + 11 row found for {version} on Uptodown (only Android 9+ with .spo Superpack available)")
    return None, None


def _try_click_turnstile(page):
    frames = [f for f in page.frames
              if "challenges.cloudflare.com" in (f.url or "")
              or "cdn-cgi/challenge-platform" in (f.url or "")]
    for f in frames:
        for sel in ("input[type='checkbox']", "input"):
            try:
                f.locator(sel).first.click(timeout=1200)
                return True
            except Exception:
                continue
        try:
            f.locator("body").click(timeout=1200, position={"x": 32, "y": 33})
            return True
        except Exception:
            continue
    return False


def solve_turnstile(page, captured_url_holder, timeout=120):
    JS = """() => {
        const el = document.getElementById('download-turnstile-widget');
        if (!el) return 'no-widget-element';
        if (typeof window.turnstile === 'undefined') return 'no-turnstile-api';
        window.__tok = null; window.__terr = null;
        try {
            window.__tid = window.turnstile.render(el, {
                sitekey: el.dataset.sitekey,
                action: 'download',
                callback: (t) => { window.__tok = t; },
                'error-callback': (e) => { window.__terr = String(e); return true; },
                'timeout-callback': () => { window.__terr = 'timeout'; },
            });
            window.turnstile.execute(window.__tid);
            return 'started';
        } catch (e) { return 'throw:' + e; }
    }"""
    setup = page.evaluate(JS)
    if setup == "no-widget-element":
        try:
            page.eval_on_selector("#detail-download-button", "el => el.click()")
            time.sleep(2)
            setup = page.evaluate(JS)
        except Exception:
            pass
    log(f"turnstile setup: {setup}")

    round_deadline = time.time() + timeout
    last_click = 0.0
    while time.time() < round_deadline:
        if captured_url_holder:
            log("download URL captured directly from page network traffic!")
            return "from_network"
        tok = page.evaluate("window.__tok")
        if tok:
            log("turnstile token received")
            return tok
        err = page.evaluate("window.__terr")
        if err:
            log(f"::warning::turnstile error {err}; resetting widget")
            time.sleep(2)
            try:
                page.evaluate("""() => {
                    window.__tok = null; window.__terr = null;
                    if (window.__tid && window.turnstile) {
                        window.turnstile.reset(window.__tid);
                        window.turnstile.execute(window.__tid);
                    }
                }""")
            except Exception:
                pass
            last_click = 0.0
            round_deadline = min(round_deadline, time.time() + 45)
        if time.time() - last_click > 5:
            _try_click_turnstile(page)
            last_click = time.time()
        time.sleep(1)
    log("::warning::turnstile timed out")
    return None


def fetch_download_url(ctx, file_id, token):
    url = f"https://facebook.en.uptodown.com/ajax/app/16791/file/{file_id}/download-url"
    resp = ctx.request.post(
        url,
        headers={
            "Content-Type": "application/json",
            "Origin": "https://facebook.en.uptodown.com",
            "Referer": f"{UT_BASE}/download/{file_id}-x",
        },
        data=json.dumps({"token": token, "onlyXapk": "1"}),
        timeout=60000,
    )
    body = resp.text()
    log(f"download-url POST -> {resp.status}: {body[:200]}")
    if resp.status != 200:
        raise RuntimeError(f"download-url HTTP {resp.status}")
    data = json.loads(body)
    return data["data"]["downloadURL"]


def download(file_id, version, out):
    from playwright.sync_api import sync_playwright

    captured_url = []

    with sync_playwright() as p:
        launch_kwargs = dict(
            headless=not os.environ.get("DISPLAY") and os.environ.get("HEADED") != "1",
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            browser = p.chromium.launch(channel="chrome", **launch_kwargs)
            log("browser: real Google Chrome")
        except Exception as e:
            log(f"chrome channel unavailable ({e}); falling back to chromium")
            browser = p.chromium.launch(**launch_kwargs)
        ctx = browser.new_context(locale="en-US", viewport={"width": 1920, "height": 1080})
        page = ctx.new_page()
        page.add_init_script(STEALTH)

        def handle_resp(response):
            if "download-url" in response.url and response.status == 200:
                try:
                    d = response.json()
                    dl = d.get("data", {}).get("downloadURL")
                    if dl:
                        captured_url.append(dl)
                except Exception:
                    pass
        page.on("response", handle_resp)

        url = f"{UT_BASE}/download/{file_id}-x"
        log(f"variant page: {url}")
        page.goto(url, wait_until="domcontentloaded", timeout=60000)

        body = page.content()
        if version not in body:
            raise RuntimeError(f"version {version} not shown on variant page")
        if "arm64-v8a" not in body:
            raise RuntimeError("variant page is not arm64-v8a")

        for sel in ("#truste-consent-button", "button:has-text('Accept')",
                    "#onetrust-accept-btn-handler"):
            try:
                page.locator(sel).first.click(timeout=2000)
                log(f"dismissed overlay: {sel}")
            except Exception:
                pass

        token = solve_turnstile(page, captured_url)
        if not token and not captured_url:
            browser.close()
            raise RuntimeError("no turnstile token or download URL captured")

        if captured_url:
            hash_ = captured_url[0]
        else:
            hash_ = fetch_download_url(ctx, file_id, token)

        file_url = ("https://dw.uptodown.com/dwn/" + hash_) if not hash_.startswith("http") else hash_
        
        # Collect cookies and headers from browser session
        cookies = ctx.cookies()
        cookie_header = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
        headers = {
            "User-Agent": UA,
            "Referer": UT_BASE + "/",
        }
        if cookie_header:
            headers["Cookie"] = cookie_header

        downloaded = False
        log(f"fetching {file_url} (streaming)")
        try:
            req = urllib.request.Request(file_url, headers=headers)
            with urllib.request.urlopen(req, timeout=180) as stream_resp:
                if stream_resp.status == 200:
                    with open(out, "wb") as fh:
                        while True:
                            chunk = stream_resp.read(1024 * 512)
                            if not chunk:
                                break
                            fh.write(chunk)
                    downloaded = True
                    log(f"streaming download complete: {os.path.getsize(out)} bytes")
        except Exception as stream_err:
            log(f"::warning::streaming download failed ({stream_err}); falling back to playwright request")

        if not downloaded:
            resp = ctx.request.get(file_url, headers={"Referer": UT_BASE + "/"}, timeout=300000)
            if resp.status != 200:
                raise RuntimeError(f"file fetch HTTP {resp.status}")
            data = resp.body()
            with open(out, "wb") as fh:
                fh.write(data)
        browser.close()


def download_via_api(file_id, out_path):
    try:
        import hashlib, hmac, random
        identifier = "".join(f"{random.randint(0, 255):02x}" for _ in range(8))
        timestamp = str(int(time.time()))
        signature = hmac.new(b"MDGMXUMdvHJBG/vjdFgmqX6LUdy7ecfwvYNd0gyfOCs=", timestamp.encode("utf-8"), hashlib.sha256).hexdigest()
        auth_url = f"https://www.uptodown.app/eapi/auth/token?identifier={identifier}"
        auth_data = urllib.parse.urlencode({
            "identifier": identifier,
            "id_plataforma": "13",
            "lang": "en",
            "unixtime": timestamp,
            "hmac": signature,
        }).encode("utf-8")
        req = urllib.request.Request(
            auth_url,
            data=auth_data,
            headers={
                "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 16; Pixel 8 Pro Build/BP4A.260205.001)",
                "Identificador": "Uptodown_Android",
                "Identificador-Version": "739",
                "Content-Type": "application/x-www-form-urlencoded",
            }
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            token = json.loads(resp.read().decode("utf-8")).get("token")
        if not token:
            return False

        dl_req = urllib.request.Request(
            f"https://www.uptodown.app/eapi/apps/16791/file/{file_id}/downloadUrl",
            headers={
                "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 16; Pixel 8 Pro Build/BP4A.260205.001)",
                "Identificador": "Uptodown_Android",
                "Identificador-Version": "739",
                "Authorization": f"Bearer {token}",
            }
        )
        with urllib.request.urlopen(dl_req, timeout=15) as resp:
            dl_url = json.loads(resp.read().decode("utf-8")).get("data", {}).get("downloadURL")
        if not dl_url:
            return False

        log(f"Downloading from direct Uptodown CDN: {dl_url[:60]}...")
        file_req = urllib.request.Request(dl_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(file_req, timeout=180) as stream_resp:
            if stream_resp.status == 200:
                with open(out_path, "wb") as fh:
                    while True:
                        chunk = stream_resp.read(1024 * 512)
                        if not chunk:
                            break
                        fh.write(chunk)
                log(f"direct Uptodown CDN download complete: {os.path.getsize(out_path)} bytes")
                return True
    except Exception as e:
        log(f"::warning::Uptodown API download failed: {e}")
    return False


def main():
    if len(sys.argv) < 3:
        log("usage: fetch_uptodown.py <version> <outdir> [--version-code <code>]")
        sys.exit(1)
    version, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)

    out = os.path.join(outdir, f"facebook-{version}-arm64-v8a.xapk")
    if os.path.isfile(out) and os.path.getsize(out) >= 10 * 1024 * 1024:
        size = os.path.getsize(out)
        log(f"Bundle already downloaded and valid: {out} ({size} bytes)")
    else:
        log(f"== Picking {version} (Android + 11) from Uptodown version history")
        file_id, sdk = pick_file_id(version)
        if not file_id:
            log(f"::error::Version {version} (Android + 11) not found on Uptodown")
            sys.exit(1)
        log(f"selected file {file_id} ({sdk})")
        if not download_via_api(file_id, out):
            download(file_id, version, out)
        size = os.path.getsize(out)
        if size < 10 * 1024 * 1024:
            log(f"::error::Downloaded file too small ({size} bytes)")
            sys.exit(1)
        log(f"saved {out} ({size} bytes)")

    # Print standard downloader JSON result on stdout
    result = {
        "path": os.path.abspath(out),
        "version": version,
        "version_code": "476015655",
        "file_type": "xapk",
        "size": size,
    }
    print(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
