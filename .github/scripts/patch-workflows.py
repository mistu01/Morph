#!/usr/bin/env python3
"""
Patches all builder workflow YAML files to add:
1. An `include_patches` string input (before create_release)
2. A "List available patches" step (before the "Build patched APKs" step or before Configure step)
3. A "Configure patch flags" step (for builders that don't have one) OR
   updated INCLUDE_PATCHES handling in the existing Configure step
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
]

INCLUDE_PATCHES_INPUT = """\
      include_patches:
        description: "Comma-separated disabled patches to enable for this run (e.g. 'Override certificate pinning, Change package name'). Leave blank to use default patch selection."
        required: false
        default: ""
"""

LIST_PATCHES_STEP = """\
      - name: List available patches
        run: |
          node << 'NODE' >> "$GITHUB_STEP_SUMMARY"
          const fs = require('fs');
          const candidates = [
            'config/youtube-options.json',
            'config/youtube-music-options.json',
            'config/reddit-options.json',
            'config/twitter-options.json',
            'config/instagram-options.json',
            '.morphe-action/options/youtube-stable.json',
            '.morphe-action/options/youtube-music-stable.json',
            '.morphe-action/options/reddit-stable.json',
          ];
          let found = false;
          for (const p of candidates) {
            if (!fs.existsSync(p)) continue;
            let bundles;
            try { bundles = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
            const bundle = Array.isArray(bundles) ? bundles[0] : bundles;
            const patches = bundle?.patches;
            if (!patches || typeof patches !== 'object') continue;
            found = true;
            const entries = Object.entries(patches);
            const enabled = entries.filter(([,v]) => v?.enabled !== false).map(([k]) => k);
            const disabled = entries.filter(([,v]) => v?.enabled === false).map(([k]) => k);
            console.log(`\\n## Patch options: \\`${p}\\`\\n`);
            console.log(`### \\u2705 Enabled patches (${enabled.length})\\n`);
            if (enabled.length) { console.log('| Patch |\\n|-------|'); enabled.forEach(n => console.log(`| ${n} |`)); }
            else { console.log('_None_'); }
            console.log(`\\n### \\u274c Disabled patches (${disabled.length})\\n`);
            if (disabled.length) { console.log('| Patch |\\n|-------|'); disabled.forEach(n => console.log(`| ${n} |`)); }
            else { console.log('_None_'); }
            console.log('\\n> To enable a disabled patch, enter its exact name in the **include_patches** input.');
          }
          if (!found) {
            console.log('\\n> No patch options file found in this repository yet. Patches will use builder defaults.');
          }
          NODE

"""

# A Configure patch flags step for builders that don't have one (Hoodles/Paresh/Piko)
CONFIGURE_STEP_NEW = """\
      - name: Configure patch flags
        env:
          CONTINUE_ON_ERROR: ${{ inputs.continue_on_error }}
          INCLUDE_PATCHES: ${{ inputs.include_patches }}
        run: |
          node <<'NODE' >> "$GITHUB_ENV"
          const args = [];
          if (process.env.CONTINUE_ON_ERROR === 'true') args.push('--continue-on-error');
          const include = (process.env.INCLUDE_PATCHES || '').split(',').map(s => s.trim()).filter(Boolean);
          for (const patch of include) { args.push('--enable', patch); }
          if (include.length) process.stderr.write(`Enabling extra patches: ${include.join(', ')}\\n`);
          console.log(`MORPHE_EXTRA_ARGS_JSON=${JSON.stringify(args)}`);
          NODE

"""

def patch_file(path_str):
    path = pathlib.Path(path_str)
    if not path.exists():
        print(f"  SKIP (not found): {path_str}")
        return

    text = path.read_text(encoding="utf-8")
    original = text
    issues = []

    # -----------------------------------------------------------------------
    # 1. Insert include_patches input before `      create_release:` input
    # -----------------------------------------------------------------------
    marker = "      create_release:\n        description: \"Create a GitHub Release"
    if INCLUDE_PATCHES_INPUT.strip() not in text:
        if marker in text:
            text = text.replace(marker, INCLUDE_PATCHES_INPUT + marker, 1)
        else:
            issues.append("could not find create_release input marker")

    # -----------------------------------------------------------------------
    # 2+3. Workflows WITH existing "Configure * patch flags" step
    # -----------------------------------------------------------------------
    configure_pattern = re.compile(
        r"(\n      - name: Configure \w.*? patch flags\n)", re.DOTALL
    )
    has_configure = bool(configure_pattern.search(text))

    if has_configure:
        # Insert List patches step before Configure step
        if LIST_PATCHES_STEP.strip() not in text:
            match = configure_pattern.search(text)
            if match:
                text = text[:match.start()] + "\n" + LIST_PATCHES_STEP + text[match.start():]
            else:
                issues.append("could not insert List patches step")

        # Add INCLUDE_PATCHES to env block in Configure step
        env_pattern = re.compile(
            r"(      - name: Configure \w.*? patch flags\n        env:\n(?:          [A-Z_]+: [^\n]+\n)*)",
            re.DOTALL
        )
        def add_include_env(m):
            block = m.group(0)
            if "INCLUDE_PATCHES" in block:
                return block
            return block.rstrip("\n") + "\n          INCLUDE_PATCHES: ${{ inputs.include_patches }}\n"
        text = env_pattern.sub(add_include_env, text)

        # Replace the run block to add include logic
        old_run = (
            "          node <<'NODE' >> \"$GITHUB_ENV\"\n"
            "          const args = [];\n"
            "          if (process.env.FORCE_PATCH === 'true') args.push('--force');\n"
            "          if (process.env.CONTINUE_ON_ERROR === 'true') args.push('--continue-on-error');\n"
            "          console.log(`MORPHE_EXTRA_ARGS_JSON=${JSON.stringify(args)}`);\n"
            "          NODE"
        )
        new_run = (
            "          node <<'NODE' >> \"$GITHUB_ENV\"\n"
            "          const args = [];\n"
            "          if (process.env.FORCE_PATCH === 'true') args.push('--force');\n"
            "          if (process.env.CONTINUE_ON_ERROR === 'true') args.push('--continue-on-error');\n"
            "          const include = (process.env.INCLUDE_PATCHES || '').split(',').map(s => s.trim()).filter(Boolean);\n"
            "          for (const patch of include) { args.push('--enable', patch); }\n"
            "          if (include.length) process.stderr.write(`Enabling extra patches: ${include.join(', ')}\\n`);\n"
            "          console.log(`MORPHE_EXTRA_ARGS_JSON=${JSON.stringify(args)}`);\n"
            "          NODE"
        )
        if old_run in text:
            text = text.replace(old_run, new_run, 1)
        elif new_run not in text:
            issues.append("could not patch Configure run block")

    else:
        # -----------------------------------------------------------------------
        # Workflows WITHOUT a Configure step (Hoodles, Paresh, Piko)
        # Insert List patches + Configure step before "Build patched APKs" step
        # and also remove CONTINUE_ON_ERROR from the Build step env since it's now
        # handled via MORPHE_EXTRA_ARGS_JSON in the Configure step
        # -----------------------------------------------------------------------
        build_step_marker = "      - name: Build patched APKs\n"
        combined = LIST_PATCHES_STEP + CONFIGURE_STEP_NEW
        if LIST_PATCHES_STEP.strip() not in text:
            if build_step_marker in text:
                text = text.replace(build_step_marker, combined + build_step_marker, 1)
            else:
                issues.append("could not find Build patched APKs step marker")

        # Add MORPHE_EXTRA_ARGS_JSON env to Build step env block (so builder picks up --enable args)
        # and add INCLUDE_PATCHES passthrough if not already there
        build_env_pattern = re.compile(
            r"(      - name: Build patched APKs\n        env:\n(?:          [A-Z_][A-Z0-9_]*: [^\n]+\n)*)",
            re.DOTALL
        )
        def add_extra_args_env(m):
            block = m.group(0)
            if "MORPHE_EXTRA_ARGS_JSON" in block:
                return block
            return block.rstrip("\n") + "\n          MORPHE_EXTRA_ARGS_JSON: ${{ env.MORPHE_EXTRA_ARGS_JSON }}\n"
        text = build_env_pattern.sub(add_extra_args_env, text)

    if issues:
        for iss in issues:
            print(f"  WARNING: {iss} in {path_str}")

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
