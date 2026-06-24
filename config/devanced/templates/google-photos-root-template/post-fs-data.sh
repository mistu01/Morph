#!/system/bin/sh
MODDIR=${0%/*}
# Ensure zygisk directory exists and is permissioned
if [ -d "$MODDIR/zygisk" ]; then
  chmod 755 "$MODDIR/zygisk"
  chmod 644 "$MODDIR/zygisk"/*/*.so >/dev/null 2>&1 || true
fi
