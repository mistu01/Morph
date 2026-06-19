import pathlib, re

files = [
    '.github/workflows/build.yml',
    '.github/workflows/build-hoodles.yml',
    '.github/workflows/build-paresh.yml',
    '.github/workflows/build-piko-new.yml',
]

checks = {
    'include_patches input': r'include_patches:',
    'List available patches step': r'- name: List available patches',
    'enabled/disabled logic': r'enabled !== false',
    'INCLUDE_PATCHES env': r'INCLUDE_PATCHES',
    '--enable arg': r'--enable',
    'MORPHE_EXTRA_ARGS_JSON set': r'MORPHE_EXTRA_ARGS_JSON',
}

for f in files:
    text = pathlib.Path(f).read_text(encoding='utf-8')
    print('=== ' + f + ' ===')
    for name, pattern in checks.items():
        found = bool(re.search(pattern, text))
        status = 'OK' if found else 'MISSING'
        print('  [' + status + '] ' + name)
    print()
