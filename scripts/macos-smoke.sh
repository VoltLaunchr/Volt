#!/usr/bin/env bash
set -euo pipefail

TAURI_ARGS="${1:-}"
APPLE_CERTIFICATE_CONFIGURED="${2:-false}"

target=""
if [[ "$TAURI_ARGS" =~ --target[[:space:]]+([^[:space:]]+) ]]; then
  target="${BASH_REMATCH[1]}"
fi

if [[ -n "$target" ]]; then
  release_dir="src-tauri/target/${target}/release"
else
  release_dir="src-tauri/target/release"
fi

bundle_dir="${release_dir}/bundle"
macos_dir="${bundle_dir}/macos"
dmg_dir="${bundle_dir}/dmg"

echo "macOS smoke: release_dir=${release_dir}"

if [[ ! -d "$macos_dir" ]]; then
  echo "::error::Missing macOS app bundle directory: ${macos_dir}"
  exit 1
fi

mapfile -t bundle_apps < <(find "$macos_dir" -maxdepth 1 -type d -name "*.app" | sort)
if [[ "${#bundle_apps[@]}" -ne 1 ]]; then
  echo "::error::Expected exactly one .app bundle in ${macos_dir}, found ${#bundle_apps[@]}"
  printf '%s\n' "${bundle_apps[@]:-}"
  exit 1
fi

bundle_app="${bundle_apps[0]}"
bundle_plist="${bundle_app}/Contents/Info.plist"

if [[ ! -f "$bundle_plist" ]]; then
  echo "::error::Missing Info.plist: ${bundle_plist}"
  exit 1
fi

bundle_id=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$bundle_plist")
bundle_executable=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$bundle_plist")
bundle_executable_path="${bundle_app}/Contents/MacOS/${bundle_executable}"

if [[ "$bundle_id" != "volt.launch" ]]; then
  echo "::error::Unexpected CFBundleIdentifier: ${bundle_id}"
  exit 1
fi

if [[ ! -x "$bundle_executable_path" ]]; then
  echo "::error::Missing executable: ${bundle_executable_path}"
  exit 1
fi

echo "macOS smoke: bundle_app=${bundle_app}"
echo "macOS smoke: executable=${bundle_executable}"

codesign --verify --deep --strict --verbose=2 "$bundle_app"

if [[ "$APPLE_CERTIFICATE_CONFIGURED" == "true" ]]; then
  codesign_details="$(codesign -dv --verbose=4 "$bundle_app" 2>&1 || true)"
  echo "$codesign_details"
  if ! grep -q "Authority=Developer ID Application" <<<"$codesign_details"; then
    echo "::error::macOS release is not signed with a Developer ID Application certificate"
    exit 1
  fi

  spctl -a -vvv -t execute "$bundle_app"
else
  echo "::warning::APPLE_CERTIFICATE is not configured; Gatekeeper assessment is expected to fail for ad-hoc signed builds"
  spctl -a -vvv -t execute "$bundle_app" || true
fi

if [[ ! -d "$dmg_dir" ]]; then
  echo "::error::Missing DMG directory: ${dmg_dir}"
  exit 1
fi

mapfile -t dmgs < <(find "$dmg_dir" -maxdepth 1 -type f -name "*.dmg" | sort)
if [[ "${#dmgs[@]}" -ne 1 ]]; then
  echo "::error::Expected exactly one .dmg in ${dmg_dir}, found ${#dmgs[@]}"
  printf '%s\n' "${dmgs[@]:-}"
  exit 1
fi

dmg="${dmgs[0]}"
echo "macOS smoke: dmg=${dmg}"
hdiutil verify "$dmg"

if [[ "$APPLE_CERTIFICATE_CONFIGURED" == "true" ]]; then
  xcrun stapler validate "$dmg"
fi

mount_point="$(mktemp -d)"
attached="false"
cleanup() {
  if [[ "$attached" == "true" ]]; then
    hdiutil detach "$mount_point" -quiet || true
  fi
  rmdir "$mount_point" 2>/dev/null || true
}
trap cleanup EXIT

hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount_point" -quiet
attached="true"

mapfile -t mounted_apps < <(find "$mount_point" -maxdepth 1 -type d -name "*.app" | sort)
if [[ "${#mounted_apps[@]}" -ne 1 ]]; then
  echo "::error::Expected exactly one .app bundle in mounted DMG, found ${#mounted_apps[@]}"
  printf '%s\n' "${mounted_apps[@]:-}"
  exit 1
fi

mounted_app="${mounted_apps[0]}"
mounted_plist="${mounted_app}/Contents/Info.plist"

if [[ ! -f "$mounted_plist" ]]; then
  echo "::error::Mounted app is missing Info.plist: ${mounted_plist}"
  exit 1
fi

mounted_bundle_id=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$mounted_plist")
mounted_executable=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$mounted_plist")
mounted_executable_path="${mounted_app}/Contents/MacOS/${mounted_executable}"

if [[ "$mounted_bundle_id" != "$bundle_id" ]]; then
  echo "::error::Mounted app bundle id mismatch: ${mounted_bundle_id} != ${bundle_id}"
  exit 1
fi

if [[ "$mounted_executable" != "$bundle_executable" ]]; then
  echo "::error::Mounted app executable mismatch: ${mounted_executable} != ${bundle_executable}"
  exit 1
fi

if [[ ! -x "$mounted_executable_path" ]]; then
  echo "::error::Mounted app is missing executable: ${mounted_executable_path}"
  exit 1
fi

echo "macOS smoke: mounted_app=${mounted_app}"

app_archs="$(lipo -archs "$mounted_executable_path")"
host_arch="$(uname -m)"
echo "macOS smoke: app_archs=${app_archs}; host_arch=${host_arch}"

if grep -qw "$host_arch" <<<"$app_archs"; then
  open -n "$mounted_app"
  for _ in {1..10}; do
    if pgrep -f "$mounted_executable_path" >/dev/null; then
      echo "macOS smoke: launch check passed"
      osascript -e "tell application id \"${mounted_bundle_id}\" to quit" || true
      pkill -f "$mounted_executable_path" || true
      exit 0
    fi
    sleep 1
  done
  echo "::error::App did not appear to start within 10 seconds"
  exit 1
else
  echo "::notice::Skipping launch check because app architecture does not match the runner"
fi
