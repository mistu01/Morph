#!/system/bin/sh

command -v ui_print >/dev/null 2>&1 || ui_print() { echo "$@"; }
command -v abort >/dev/null 2>&1 || abort() { ui_print "! $*"; exit 1; }

ui_print ""
ui_print "*******************************"
ui_print "  $MODNAME"
ui_print "  by mistu"
ui_print "*******************************"
ui_print ""
ui_print "- Root managers: Magisk, KernelSU, KernelSU Next, APatch"
ui_print "- Package mode: original package names"
ui_print "- Install mode: stock package registration + patched base.apk bind mount"
ui_print "- Play Store: detach installer/database ownership"
ui_print "- Legacy replace file: not used"
ui_print ""

APP_LIST=$(cat <<'EOF_APP_LIST'
{{APP_LIST}}
EOF_APP_LIST
)

DATA_DIR=/data/adb/mistu-root/${MODPATH##*/}
mkdir -p "$DATA_DIR"

if [ -f "$MODPATH/common.tar.xz" ]; then
  ui_print "  Extracting APK resources (tar.xz)..."
  tar -xf "$MODPATH/common.tar.xz" -C "$MODPATH" || abort "Failed to extract APK resources"
  rm -f "$MODPATH/common.tar.xz"
fi

pmex() {
  local out
  out="$(pm "$@" 2>&1 </dev/null)"
  local status=$?
  printf '%s\n' "$out"
  return $status
}

pm_base_path() {
  pm path "$1" 2>/dev/null | sed -n 's/^package://p' | grep '/base\.apk$' | head -n 1
}

uninstall_system_updates_if_needed() {
  local pkg="$1" flags
  flags="$(dumpsys package "$pkg" 2>/dev/null | grep -m1 'pkgFlags=')"
  if printf '%s\n' "$flags" | grep -Fq UPDATED_SYSTEM_APP; then
    ui_print "  Removing Play Store system update overlay"
    pmex uninstall-system-updates "$pkg" >/dev/null 2>&1 || true
  fi
}

set_pm_installer() {
  cmd package set-installer "$1" com.android.shell >/dev/null 2>&1 || true
  pm set-installer "$1" com.android.shell >/dev/null 2>&1 || true
}

enable_package() {
  cmd package install-existing --user 0 "$1" >/dev/null 2>&1 || true
  pm enable "$1" >/dev/null 2>&1 || true
  cmd package unsuspend "$1" >/dev/null 2>&1 || true
}

install_stock_session() {
  local pkg="$1" label="$2" stock_dir="$3"
  local total size session out verify_adb package_verifier apk name
  [ -d "$stock_dir" ] || abort "Missing stock APK directory for $label: $stock_dir"
  total=0
  for apk in "$stock_dir"/*.apk; do
    [ -f "$apk" ] || continue
    size="$(wc -c < "$apk")"
    total=$((total + size))
  done
  [ "$total" -gt 0 ] || abort "No stock APK files found for $label in $stock_dir"
  verify_adb="$(settings get global verifier_verify_adb_installs 2>/dev/null)"
  package_verifier="$(settings get global package_verifier_enable 2>/dev/null)"
  settings put global verifier_verify_adb_installs 0 >/dev/null 2>&1 || true
  settings put global package_verifier_enable 0 >/dev/null 2>&1 || true
  out="$(pm install-create --user 0 -i com.android.vending -r -d -S "$total" 2>&1)" || { settings put global verifier_verify_adb_installs "$verify_adb" >/dev/null 2>&1 || true; settings put global package_verifier_enable "$package_verifier" >/dev/null 2>&1 || true; last_pm_error="$out"; ui_print "$out"; return 1; }
  session="${out#*[}"
  session="${session%]}"
  for apk in "$stock_dir"/*.apk; do
    [ -f "$apk" ] || continue
    size="$(wc -c < "$apk")"
    name="${apk##*/}"
    out="$(pm install-write -S "$size" "$session" "$name" "$apk" 2>&1)" || { pm install-abandon "$session" >/dev/null 2>&1 || true; settings put global verifier_verify_adb_installs "$verify_adb" >/dev/null 2>&1 || true; settings put global package_verifier_enable "$package_verifier" >/dev/null 2>&1 || true; last_pm_error="$out"; ui_print "$out"; return 1; }
  done
  out="$(pm install-commit "$session" 2>&1)" || { settings put global verifier_verify_adb_installs "$verify_adb" >/dev/null 2>&1 || true; settings put global package_verifier_enable "$package_verifier" >/dev/null 2>&1 || true; last_pm_error="$out"; ui_print "$out"; return 1; }
  settings put global verifier_verify_adb_installs "$verify_adb" >/dev/null 2>&1 || true
  settings put global package_verifier_enable "$package_verifier" >/dev/null 2>&1 || true
}

install_stock_package() {
  local pkg="$1" label="$2" stock_dir="$3"
  local existing_base
  [ -d "$stock_dir" ] || abort "Missing stock APK directory for $label: $stock_dir"
  uninstall_system_updates_if_needed "$pkg"
  existing_base="$(pm_base_path "$pkg")"
  if [ -n "$existing_base" ]; then
    ui_print "  Refreshing original package registration"
    if ! install_stock_session "$pkg" "$label" "$stock_dir"; then
      if printf '%s\n' "$last_pm_error" | grep -Eq 'INSTALL_FAILED_VERSION_DOWNGRADE|INSTALL_FAILED_UPDATE_INCOMPATIBLE'; then
        ui_print "  Downgrade detected: removing conflicting newer app update"
        pm uninstall -k "$pkg" >/dev/null 2>&1 || pm uninstall "$pkg" >/dev/null 2>&1 || true
        if ! install_stock_session "$pkg" "$label" "$stock_dir"; then
          ui_print "  Stock refresh failed after cleanup; keeping existing package registration"
        fi
      else
        ui_print "  Stock refresh failed; keeping existing package registration"
      fi
    fi
    enable_package "$pkg"
    return 0
  fi
  ui_print "  Registering original package with stock APK files"
  install_stock_session "$pkg" "$label" "$stock_dir" || abort "stock package install failed for $label"
  enable_package "$pkg"
}

mount_bind_global() {
  local source="$1" target="$2" out
  if su -M -c true >/dev/null 2>&1; then
    out="$(su -M -c "mount -o bind '$source' '$target'" 2>&1)" || { ui_print "$out"; return 1; }
  elif command -v nsenter >/dev/null 2>&1; then
    out="$(nsenter -t 1 -m mount -o bind "$source" "$target" 2>&1)" || { ui_print "$out"; return 1; }
  else
    out="$(mount -o bind "$source" "$target" 2>&1)" || { ui_print "$out"; return 1; }
  fi
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

stage_patched_apk() {
  local source="$1" target="$2" tmp
  tmp="$target.tmp.$$"
  rm -f "$tmp" >/dev/null 2>&1 || true
  cp -f "$source" "$tmp" || { rm -f "$tmp" >/dev/null 2>&1 || true; return 1; }
  chmod 0644 "$tmp"
  chcon u:object_r:apk_data_file:s0 "$tmp" >/dev/null 2>&1 || true
  mv -f "$tmp" "$target" || { rm -f "$tmp" >/dev/null 2>&1 || true; return 1; }
  sync "$target" >/dev/null 2>&1 || sync >/dev/null 2>&1 || true
}

install_root_apk() {
  local pkg="$1" label="$2" patched_name="$3" stock_dir_name="$4" fallback_path="$5"
  local patched_apk stock_dir persistent_apk target_path
  patched_apk="$MODPATH/common/patched/$patched_name"
  stock_dir="$MODPATH/common/stock/$stock_dir_name"
  persistent_apk="$DATA_DIR/$pkg.apk"
  [ -f "$patched_apk" ] || abort "Missing patched APK for $label: $patched_apk"

  ui_print "- App: $label"
  ui_print "  Package: $pkg"
  am force-stop "$pkg" >/dev/null 2>&1 || true
  target_path="$(pm_base_path "$pkg")"
  unmount_global "$target_path"
  install_stock_package "$pkg" "$label" "$stock_dir"
  target_path="$(pm_base_path "$pkg")"
  [ -n "$target_path" ] || abort "Package path not found after stock registration for $label"
  stage_patched_apk "$patched_apk" "$persistent_apk" || abort "Failed to stage patched APK for $label"
  cmd package compile --reset "$pkg" >/dev/null 2>&1 || true
  unmount_global "$target_path"
  mount_bind_global "$persistent_apk" "$target_path" || abort "Bind mount failed for $label"
  set_pm_installer "$pkg"
  am force-stop "$pkg" >/dev/null 2>&1 || true
  cmd package compile -m speed-profile -f "$pkg" >/dev/null 2>&1 || true
  ui_print "  Stock base: $target_path"
  ui_print "  Patched base: $persistent_apk"
}

while IFS='|' read -r pkg label patched_name stock_name fallback_path; do
  [ -n "$pkg" ] || continue
  install_root_apk "$pkg" "$label" "$patched_name" "$stock_name" "$fallback_path"
done <<EOF_INSTALL_APPS
{{APP_LIST}}
EOF_INSTALL_APPS

rm -rf "$MODPATH/common"
ui_print ""
ui_print "- Install files prepared successfully"
ui_print "- Reboot is required"
ui_print ""
