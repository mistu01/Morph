#!/usr/bin/env python3
"""
Rewrites the "List available patches" step in all builder workflows to:
- Read from .cache/tools/patches-list.json (downloaded during tools step)
- Group patches PER APP (by compatiblePackages)
- Show enabled (default:true) and disabled (default:false) per app
- Cross-reference with local options file if present (it overrides defaults)
- Show ALL apps supported by the builder, not just the selected targets
"""

import re
import pathlib

WORKFLOWS = [
    ".github/workflows/build.yml",
    ".github/workflows/build-anddea.yml",
    ".github/workflows/build-anddea-root-modules.yml",
    ".github/workflows/build-root-modules.yml",
    ".github/workflows/build-hoodles.yml",
    ".github/workflows/build-paresh.yml",
    ".github/workflows/build-piko-new.yml",
    ".github/workflows/build-gboard-patches.yml",
]

# The new improved List available patches step
NEW_LIST_STEP = """\
      - name: List available patches
        run: |
          node << 'NODE' >> "$GITHUB_STEP_SUMMARY"
          const fs = require('fs');

          // Load patches-list.json (downloaded by the tools step)
          const listPath = '.cache/tools/patches-list.json';
          if (!fs.existsSync(listPath)) {
            console.log('\\n> `patches-list.json` not found. Ensure the Download tools step ran successfully.');
            process.exit(0);
          }

          const patchesList = JSON.parse(fs.readFileSync(listPath, 'utf8'));
          const allPatches = patchesList.patches || [];

          // Load local options files to get user-overridden enabled/disabled state
          const optionsCandidates = [
            'config/youtube-options.json',
            'config/youtube-music-options.json',
            'config/reddit-options.json',
            'config/twitter-options.json',
            'config/instagram-options.json',
            'config/gboard-options.json',
            'config/gboard-patches-options.json',
            'config/piko/instagram-options.json',
            'config/piko/twitter-options.json',
            '.morphe-action/options/youtube-stable.json',
            '.morphe-action/options/youtube-music-stable.json',
            '.morphe-action/options/reddit-stable.json',
          ];
          // Build a map: patchName -> enabled (from options files)
          const optionsOverride = {};
          for (const p of optionsCandidates) {
            if (!fs.existsSync(p)) continue;
            try {
              const bundles = JSON.parse(fs.readFileSync(p, 'utf8'));
              const bundle = Array.isArray(bundles) ? bundles[0] : bundles;
              const patches = bundle?.patches;
              if (!patches || typeof patches !== 'object') continue;
              for (const [name, val] of Object.entries(patches)) {
                if (typeof val?.enabled === 'boolean') {
                  optionsOverride[name] = val.enabled;
                }
              }
            } catch {}
          }

          // Collect all apps from compatiblePackages across all patches
          const appMap = new Map(); // packageName -> { appName, patches: [{name, enabled}] }
          for (const patch of allPatches) {
            if (!patch.name) continue;
            const pkgs = patch.compatiblePackages;
            let pkgList = [];
            if (Array.isArray(pkgs)) {
              pkgList = pkgs;
            } else if (pkgs && typeof pkgs === 'object') {
              pkgList = Object.entries(pkgs).map(([packageName, detail]) => ({
                packageName,
                name: detail?.name || packageName
              }));
            }
            if (pkgList.length === 0) continue;
            for (const pkg of pkgList) {
              if (!appMap.has(pkg.packageName)) {
                appMap.set(pkg.packageName, { appName: pkg.name || pkg.packageName, patches: [] });
              }
              // Determine enabled state: options file overrides default
              const enabled = optionsOverride.hasOwnProperty(patch.name)
                ? optionsOverride[patch.name]
                : (patch.use !== false);
              appMap.get(pkg.packageName).patches.push({ name: patch.name, enabled });
            }
          }

          if (appMap.size === 0) {
            console.log('\\n> No compatible-package patch entries found in patches-list.json.');
            process.exit(0);
          }

          console.log('\\n# Available Patches by App\\n');
          if (Object.keys(optionsOverride).length > 0) {
            console.log('> ℹ️ Enabled/disabled state reflects your local options files. Patches not in options files use their default state.\\n');
          } else {
            console.log('> ℹ️ No local options files found. Showing **default** enabled/disabled state from the patch source.\\n');
          }
          console.log('> To enable a **disabled** patch, copy its exact name into the **include_patches** input.\\n');
          console.log('---\\n');

          for (const [pkgName, { appName, patches }] of [...appMap.entries()].sort((a,b) => a[1].appName.localeCompare(b[1].appName))) {
            const enabled = patches.filter(p => p.enabled);
            const disabled = patches.filter(p => !p.enabled);
            console.log(`## ${appName}\\n`);
            console.log(`> Package: \`${pkgName}\` — **${enabled.length}** enabled, **${disabled.length}** disabled\\n`);

            console.log(`### ✅ Enabled (${enabled.length})\\n`);
            if (enabled.length) {
              console.log('| Patch Name |\\n|------------|');
              for (const p of enabled) console.log(`| ${p.name} |`);
            } else {
              console.log('_None_');
            }

            console.log(`\\n### ❌ Disabled (${disabled.length})\\n`);
            if (disabled.length) {
              console.log('| Patch Name |\\n|------------|');
              for (const p of disabled) console.log(`| ${p.name} |`);
            } else {
              console.log('_None_');
            }
            console.log('\\n---\\n');
          }
          NODE

"""

OLD_LIST_STEP_PATTERN = re.compile(
    r"      - name: List available patches\n        run: \|.*?NODE\n\n",
    re.DOTALL
)

def patch_file(path_str):
    path = pathlib.Path(path_str)
    if not path.exists():
        print(f"  SKIP (not found): {path_str}")
        return

    text = path.read_text(encoding="utf-8")
    original = text

    if OLD_LIST_STEP_PATTERN.search(text):
        text = OLD_LIST_STEP_PATTERN.sub(NEW_LIST_STEP, text)
    else:
        print(f"  WARNING: could not find old List patches step in {path_str}")

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  PATCHED: {path_str}")
    else:
        print(f"  NO CHANGE: {path_str}")


root = pathlib.Path(__file__).parent.parent.parent
for wf in WORKFLOWS:
    full = root / wf
    print(f"Processing: {wf}")
    patch_file(str(full))

print("\nDone.")
