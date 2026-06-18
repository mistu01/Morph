# Morphe Python App Release action

The **Morphe Python App Release** workflow is independent from the existing
Node-based builders. Start it from **Actions → Morphe Python App Release → Run
workflow**.

The run:

1. Downloads the selected stable/dev Morphe CLI release.
2. Downloads the selected stable/dev patch bundle release.
3. Asks Morphe CLI for the app's recommended compatible version unless an APK
   version was entered manually.
4. Resolves and downloads the APK/APKM through Morphe's download service.
5. Generates Morphe's default/recommended patch options and applies any explicit
   enable/disable overrides.
6. Patches, rebuilds, aligns, and signs the APK.
7. Validates Morphe's result JSON and creates a release or draft.
8. Uploads the APK and result JSON as a three-day workflow artifact.

Built-in app choices are Reddit, YouTube, and YouTube Music. Select `custom` and
provide an Android package name for another app supported by the chosen patch
source.

Only use patch repositories you trust: an MPP bundle contains executable patch
code. The controller removes the GitHub token from Morphe's Java subprocess,
while retaining it only for authenticated downloads and release creation.

## Signing secrets

Signing secrets are optional, but strongly recommended so updates retain the
same certificate between runs:

- `APK_KEYSTORE_B64`: base64-encoded JKS, PKCS12, or BKS keystore.
- `APK_KEYSTORE_PASSWORD`
- `APK_KEYSTORE_ALIAS`
- `APK_KEYSTORE_ENTRY_PASSWORD`

Without them, Morphe generates an ephemeral signing key for that run.

## Release behavior

- `release`: publishes immediately. Dev patch builds are marked prerelease.
- `draft`: creates a draft release.
- `artifact-only`: skips GitHub Release creation but keeps the workflow artifact.

The workflow grants only `contents: write`, which is needed to create releases.
