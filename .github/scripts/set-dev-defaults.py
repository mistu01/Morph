import pathlib

files = [
    '.github/workflows/build.yml',
    '.github/workflows/build-anddea.yml',
    '.github/workflows/build-anddea-root-modules.yml',
    '.github/workflows/build-root-modules.yml',
    '.github/workflows/build-hoodles.yml',
    '.github/workflows/build-paresh.yml',
    '.github/workflows/build-piko-new.yml',
    '.github/workflows/build-gboard-patches.yml',
]

changed = 0
for f in files:
    path = pathlib.Path(f)
    if not path.exists():
        continue
    text = path.read_text(encoding='utf-8')
    original = text

    # Change cli_version default: "latest" -> "dev"
    # The cli_version block always has this description right before the default
    text = text.replace(
        'description: "Morphe CLI tag, or latest"\r\n        required: true\r\n        default: "latest"',
        'description: "Morphe CLI tag, or latest"\r\n        required: true\r\n        default: "dev"'
    )
    text = text.replace(
        'description: "Morphe CLI tag, or latest"\n        required: true\n        default: "latest"',
        'description: "Morphe CLI tag, or latest"\n        required: true\n        default: "dev"'
    )

    # Change patches_version/patches_type default: "stable" -> "dev"
    text = text.replace('        default: "stable"', '        default: "dev"')

    if text != original:
        path.write_text(text, encoding='utf-8')
        print('PATCHED: ' + f)
        changed += 1
    else:
        print('NO CHANGE: ' + f)

print(str(changed) + ' files changed.')
