#!/system/bin/sh

MODDIR=${0%/*}
LOG="$MODDIR/root-module.log"
DATA_DIR=/data/adb/mistu-root/${MODDIR##*/}
ORIG_PROP="$MODDIR/module.prop.orig"
PLAY_STORE=com.android.vending
APP_LIST=$(cat <<'EOF_APP_LIST'
{{APP_LIST}}
EOF_APP_LIST
)

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [$1] $2" >> "$LOG"
}

set_description_status() {
  local status="$1"
  local base_description description_tmp
  [ -f "$ORIG_PROP" ] || cp "$MODDIR/module.prop" "$ORIG_PROP" >/dev/null 2>&1 || true
  [ -f "$ORIG_PROP" ] && cp "$ORIG_PROP" "$MODDIR/module.prop" >/dev/null 2>&1 || true
  base_description="$(sed -n 's/^description=//p' "$ORIG_PROP" 2>/dev/null | head -n 1)"
  base_description="${base_description%% | Status: *}"
  [ -n "$base_description" ] || base_description="Mistu root module"
  if [ -f "$MODDIR/module.prop" ]; then
    description_tmp="$MODDIR/module.prop.tmp"
    awk -v description="$base_description | Status: $status" '
      BEGIN { updated = 0 }
      /^description=/ { print "description=" description; updated = 1; next }
      { print }
      END { if (!updated) print "description=" description }
    ' "$MODDIR/module.prop" > "$description_tmp" && mv "$description_tmp" "$MODDIR/module.prop"
    rm -f "$description_tmp" >/dev/null 2>&1 || true
  fi
}

pm_base_path() {
  pm path "$1" 2>/dev/null | sed -n 's/^package://p' | grep '/base\.apk$' | head -n 1
}

mount_bind_global() {
  local source="$1" target="$2"
  if su -M -c true >/dev/null 2>&1; then
    su -M -c "mount -o bind '$source' '$target'" >/dev/null 2>&1 && return 0
  fi
  if command -v nsenter >/dev/null 2>&1; then
    nsenter -t 1 -m mount -o bind "$source" "$target" >/dev/null 2>&1 && return 0
  fi
  mount -o bind "$source" "$target" >/dev/null 2>&1
}

unmount_global() {
  local target="$1"
  [ -n "$target" ] || return 0
  if su -M -c true >/dev/null 2>&1; then
    su -M -c "umount '$target' || umount -l '$target'" >/dev/null 2>&1 && return 0
  fi
  if command -v nsenter >/dev/null 2>&1; then
    nsenter -t 1 -m umount "$target" >/dev/null 2>&1 && return 0
    nsenter -t 1 -m umount -l "$target" >/dev/null 2>&1 && return 0
  fi
  umount "$target" >/dev/null 2>&1 || umount -l "$target" >/dev/null 2>&1 || true
}

apply_package() {
  local pkg="$1" label="$2" patched_apk target_path
  patched_apk="$DATA_DIR/$pkg.apk"
  [ -f "$patched_apk" ] || { log "warn" "$label patched APK missing at $patched_apk"; set_description_status "Needs reinstall: $label patched APK missing"; return 0; }
  cmd package install-existing "$pkg" >/dev/null 2>&1 || true
  pm enable "$pkg" >/dev/null 2>&1 || true
  cmd package unsuspend "$pkg" >/dev/null 2>&1 || true
  target_path="$(pm_base_path "$pkg")"
  [ -n "$target_path" ] || { log "warn" "$label package path not found"; set_description_status "Needs reinstall: $label package path not found"; return 0; }
  cmd package compile --reset "$pkg" >/dev/null 2>&1 || true
  unmount_global "$target_path"
  if ! mount_bind_global "$patched_apk" "$target_path"; then
    log "warn" "$label bind mount failed for $target_path"
    set_description_status "Needs reinstall: $label bind mount failed"
    return 0
  fi
  cmd package set-installer "$pkg" com.android.shell >/dev/null 2>&1 || true
  pm set-installer "$pkg" com.android.shell >/dev/null 2>&1 || true
  cmd package compile -m speed-profile -f "$pkg" >/dev/null 2>&1 || true
}

detach_play_store_db() {
  command -v sqlite3 >/dev/null 2>&1 || return 0
  [ -d /data/data/$PLAY_STORE/databases ] || return 0

  local pkg label db
  while IFS='|' read -r pkg label; do
    [ -n "$pkg" ] || continue
    for db in /data/data/$PLAY_STORE/databases/*.db; do
      [ -f "$db" ] || continue
      sqlite3 "$db" "DELETE FROM ownership WHERE doc_id='$pkg' OR package_name='$pkg' OR packageName='$pkg';" >/dev/null 2>&1 || true
      sqlite3 "$db" "DELETE FROM auto_update WHERE doc_id='$pkg' OR package_name='$pkg' OR packageName='$pkg';" >/dev/null 2>&1 || true
      sqlite3 "$db" "DELETE FROM appstate WHERE package_name='$pkg' OR packageName='$pkg';" >/dev/null 2>&1 || true
      sqlite3 "$db" "UPDATE localappstate SET auto_update=0 WHERE package_name='$pkg' OR packageName='$pkg';" >/dev/null 2>&1 || true
      sqlite3 "$db" "UPDATE local_app_state SET auto_update=0 WHERE package_name='$pkg' OR packageName='$pkg';" >/dev/null 2>&1 || true
    done
  done <<EOF_DETACH_APPS
$APP_LIST
EOF_DETACH_APPS
}

while IFS='|' read -r pkg label; do
  [ -n "$pkg" ] || continue
  apply_package "$pkg" "$label"
done <<EOF_APPLY_APPS
$APP_LIST
EOF_APPLY_APPS
detach_play_store_db
set_description_status "Active: patched APK bind-mounted over original package"
log "ok" "Applied root module bind mounts and Play Store detach."
