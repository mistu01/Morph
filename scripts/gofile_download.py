#!/usr/bin/env python3

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "scripts" / "vendor" / "gofile_dl"
PACKAGE_EXTENSIONS = (".apkm", ".xapk", ".apks", ".apk")


def main():
    parser = argparse.ArgumentParser(
        description="Download an APK package from Gofile using martadams89/gofile-dl."
    )
    parser.add_argument("--url", required=True, help="Gofile share URL")
    parser.add_argument("--out-dir", required=True, help="Destination directory")
    parser.add_argument("--out-file", required=True, help="Preferred output file name")
    parser.add_argument("--password", default="", help="Optional Gofile folder password")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("CONFIG_DIR", str(ROOT / ".cache" / "gofile-dl-config"))
    sys.path.insert(0, str(VENDOR))
    from run import GoFile

    with tempfile.TemporaryDirectory(prefix="gofile-dl-", dir=str(ROOT / ".cache")) as temp_dir:
        temp_path = Path(temp_dir)
        GoFile().execute(dir=str(temp_path), url=args.url, password=args.password or None)

        package = select_package_file(temp_path)
        if not package:
            downloaded = [str(path.relative_to(temp_path)) for path in temp_path.rglob("*") if path.is_file()]
            raise SystemExit(
                "gofile-dl did not download an APK/APKM/XAPK/APKS file. "
                f"Downloaded files: {downloaded[:20]}"
            )

        destination = out_dir / replace_extension(args.out_file, package.suffix.lower())
        if destination.exists():
            destination.unlink()
        shutil.move(str(package), destination)

    print(json.dumps({
        "path": str(destination.resolve()),
        "name": package.name,
        "source": "martadams89/gofile-dl",
        "url": args.url,
    }))


def select_package_file(directory):
    candidates = [
        path for path in directory.rglob("*")
        if path.is_file() and path.suffix.lower() in PACKAGE_EXTENSIONS
    ]
    return sorted(candidates, key=package_rank)[0] if candidates else None


def package_rank(path):
    name = path.name.lower()
    ext_rank = {".apkm": 0, ".xapk": 1, ".apks": 2, ".apk": 3}.get(path.suffix.lower(), 9)
    name_rank = 0 if any(part in name for part in ("twitter", "x.")) else 1
    return (name_rank, ext_rank, len(path.parts), name)


def replace_extension(file_name, extension):
    if extension not in PACKAGE_EXTENSIONS:
        extension = ".apk"
    stem = Path(urlparse(file_name).path).stem or "twitter"
    return f"{stem}{extension}"


if __name__ == "__main__":
    main()
