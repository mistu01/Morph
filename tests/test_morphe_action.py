import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.morphe_action import (
    apply_patch_overrides,
    choose_release,
    extract_apkmirror_links,
    parse_compatible_versions,
    run_command,
)


class MorpheActionTests(unittest.TestCase):
    def test_selects_stable_and_dev_releases(self):
        releases = [
            {"tag_name": "v2.0.0-dev.1", "prerelease": True},
            {"tag_name": "v1.9.0", "prerelease": False},
        ]
        self.assertEqual(choose_release(releases, "stable")["tag_name"], "v1.9.0")
        self.assertEqual(choose_release(releases, "dev")["tag_name"], "v2.0.0-dev.1")
        self.assertEqual(choose_release(releases, "stable", "1.9.0")["tag_name"], "v1.9.0")

    def test_parses_recommended_version(self):
        output = "Most common compatible versions:\n\t2026.14.0 (14 patches)\n"
        versions = parse_compatible_versions(output)
        self.assertEqual((versions[0].version, versions[0].patch_count), ("2026.14.0", 14))

    def test_applies_patch_overrides_case_insensitively(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "options.json"
            path.write_text(json.dumps([{"patches": {
                "Hide ads": {"enabled": True, "options": {}},
                "Enable debug": {"enabled": False, "options": {}},
            }}]), encoding="utf-8")
            apply_patch_overrides(path, ["enable DEBUG"], ["hide ADS"])
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertFalse(data[0]["patches"]["Hide ads"]["enabled"])
            self.assertTrue(data[0]["patches"]["Enable debug"]["enabled"])

    def test_extracts_apkmirror_links(self):
        body = (
            '<a href="/app/download/?key=abc">one</a>'
            '<a href="/wp-content/themes/APKMirror/download.php?id=1&amp;key=xyz">two</a>'
        )
        intermediate, direct = extract_apkmirror_links("https://www.apkmirror.com/app/", body)
        self.assertEqual(intermediate, "https://www.apkmirror.com/app/download/?key=abc")
        self.assertIn("download.php?id=1&key=xyz", direct)

    def test_github_token_is_removed_from_morphe_children(self):
        previous = os.environ.get("GH_TOKEN")
        os.environ["GH_TOKEN"] = "must-not-leak"
        try:
            result = run_command(
                [sys.executable, "-c", "import os; print(os.getenv('GH_TOKEN', 'missing'))"],
                capture=True,
                drop_github_token=True,
            )
            self.assertEqual(result.stdout.strip(), "missing")
        finally:
            if previous is None:
                os.environ.pop("GH_TOKEN", None)
            else:
                os.environ["GH_TOKEN"] = previous


if __name__ == "__main__":
    unittest.main()
