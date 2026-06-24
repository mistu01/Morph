#!/system/bin/sh
MODDIR=${0%/*}
DATA_DIR=/data/adb/mistu-root/${MODDIR##*/}
PACKAGES="com.google.android.apps.photos"
for pkg in $PACKAGES; do
  cmd package set-installer "$pkg" com.android.vending >/dev/null 2>&1 || true
  pm set-installer "$pkg" com.android.vending >/dev/null 2>&1 || true
done
rm -rf "$DATA_DIR"
