import { readFileSync, existsSync } from 'node:fs';

const listPath = '.cache/tools/patches-list.json';
if (!existsSync(listPath)) {
  console.log('\n> `patches-list.json` not found — tools step may not have run yet.');
  process.exit(0);
}

let patchesData;
try {
  patchesData = JSON.parse(readFileSync(listPath, 'utf8'));
} catch (e) {
  console.log(`\n> Failed to parse \`patches-list.json\`: ${e.message}`);
  process.exit(1);
}

const allPatches = patchesData.patches || [];

// Load options overrides
const optionsOverride = {};
const candidates = [
  'config/youtube-options.json', 'config/youtube-music-options.json',
  'config/reddit-options.json', 'config/twitter-options.json', 'config/instagram-options.json',
  '.morphe-action/options/youtube-stable.json', '.morphe-action/options/youtube-music-stable.json',
  '.morphe-action/options/reddit-stable.json',
];
for (const p of candidates) {
  if (!existsSync(p)) continue;
  try {
    const bundles = JSON.parse(readFileSync(p, 'utf8'));
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

// Group by app
const appMap = new Map();
for (const patch of allPatches) {
  if (!patch.name) continue;
  const enabled = Object.hasOwn(optionsOverride, patch.name)
    ? optionsOverride[patch.name]
    : patch.use !== false;

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

  if (pkgList.length === 0) {
    const pkgName = 'universal';
    if (!appMap.has(pkgName)) {
      appMap.set(pkgName, { appName: "Universal (All Apps)", patches: [] });
    }
    appMap.get(pkgName).patches.push({ name: patch.name, enabled });
  } else {
    for (const pkg of pkgList) {
      if (!pkg.packageName) continue;
      const pkgName = pkg.packageName;
      if (!appMap.has(pkgName)) {
        appMap.set(pkgName, { appName: pkg.name || pkgName, patches: [] });
      }
      appMap.get(pkgName).patches.push({ name: patch.name, enabled });
    }
  }
}

const hasOverrides = Object.keys(optionsOverride).length > 0;
const lines = [];
lines.push('# Available Patches by App');
lines.push('');
lines.push(hasOverrides
  ? '> ℹ️ State reflects your local options files. Unlisted patches use their default.'
  : '> ℹ️ No local options files found — showing **default** enabled/disabled from patch source.');
lines.push('> To enable a **disabled** patch, copy its exact name into the **include_patches** input.');
lines.push('');
lines.push('---');
lines.push('');

const sortedApps = [...appMap.entries()].sort((a, b) => {
  // Always put Universal at the top if it exists, otherwise alphabetical by appName
  if (a[0] === 'universal') return -1;
  if (b[0] === 'universal') return 1;
  return a[1].appName.localeCompare(b[1].appName);
});

for (const [pkgName, { appName, patches }] of sortedApps) {
  // Sort patches alphabetically by name
  patches.sort((a, b) => a.name.localeCompare(b.name));
  const enabled = patches.filter(p => p.enabled);
  const disabled = patches.filter(p => !p.enabled);

  lines.push(`## ${appName}`);
  lines.push(`> Package: \`${pkgName}\` | **${enabled.length}** enabled, **${disabled.length}** disabled`);
  lines.push('');
  lines.push(`### \u2705 Enabled (${enabled.length})`);
  if (enabled.length) {
    lines.push('| Patch |');
    lines.push('|---|');
    for (const p of enabled) {
      lines.push(`| ${p.name} |`);
    }
  } else {
    lines.push('_None_');
  }
  lines.push('');
  lines.push(`### \u274c Disabled (${disabled.length})`);
  if (disabled.length) {
    lines.push('| Patch |');
    lines.push('|---|');
    for (const p of disabled) {
      lines.push(`| ${p.name} |`);
    }
  } else {
    lines.push('_None_');
  }
  lines.push('');
  lines.push('---');
  lines.push('');
}

process.stdout.write(lines.join('\n'));
