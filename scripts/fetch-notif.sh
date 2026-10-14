#!/usr/bin/env bash
# Download the released notif binary for one VSIX target into bin/.
#
# Usage : NOTIF_RELEASE_TAG=v0.3.0 scripts/fetch-notif.sh <vsce-target>
#   <vsce-target>  darwin-arm64 | darwin-x64 | win32-x64 | win32-arm64
#   Needs : gh (authenticated, GH_TOKEN in CI), sha256sum, unzip / tar.
#
# The binary comes from a GitHub Release of meitogi/notifier. That release
# publishes one asset per target plus a SHA256SUMS file (sha256sum format).
# This script verifies the asset against SHA256SUMS before using it.
#
# Filling in the asset names (once notifier's release workflow has shipped) :
#   1. Open the notifier release page and copy each asset's exact file name.
#   2. Put it in the matching branch of asset_for_target below. This table
#      is the only place that names notifier assets.
#   3. In this repo's GitHub settings, set the Actions variable
#      NOTIF_RELEASE_TAG to that release's tag (e.g. v0.3.0).
#   4. Check it locally :
#        NOTIF_RELEASE_TAG=v0.3.0 scripts/fetch-notif.sh darwin-arm64
#      → bin/notif present, mode 755, "checksum OK" printed.
set -euo pipefail

NOTIF_REPO="meitogi/notifier"

asset_for_target() {
  case "$1" in
    darwin-arm64) echo "" ;;
    darwin-x64)   echo "" ;;
    win32-x64)    echo "" ;;
    win32-arm64)  echo "" ;;
    *) echo "::error::unknown target '$1' (expected darwin-arm64, darwin-x64, win32-x64 or win32-arm64)" >&2; exit 2 ;;
  esac
}

target="${1:-}"
if [ -z "$target" ]; then
  echo "usage: NOTIF_RELEASE_TAG=<tag> $0 <vsce-target>" >&2
  exit 2
fi
asset="$(asset_for_target "$target")"

tag="${NOTIF_RELEASE_TAG:-}"
if [ -z "$tag" ]; then
  echo "::error::NOTIF_RELEASE_TAG is unset — no notif release to bundle. Blocked until meitogi/notifier ships its release workflow ; then set the Actions variable NOTIF_RELEASE_TAG (see the header of $0)." >&2
  exit 1
fi
if [ -z "$asset" ]; then
  echo "::error::no notif asset name for '$target' yet — fill asset_for_target in $0 from the $NOTIF_REPO $tag release page (see the header)." >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

gh release download "$tag" -R "$NOTIF_REPO" -p "$asset" -p SHA256SUMS -D "$work"
if ! grep -q "  \*\?$asset\$" "$work/SHA256SUMS"; then
  echo "::error::$asset is not listed in SHA256SUMS of $NOTIF_REPO $tag" >&2
  exit 1
fi
(cd "$work" && grep "  \*\?$asset\$" SHA256SUMS | sha256sum -c -)
echo "checksum OK : $asset"

case "$target" in
  win32-*) bin_name="notif.exe" ;;
  *)       bin_name="notif" ;;
esac
case "$asset" in
  *.zip)    unzip -q "$work/$asset" -d "$work/x" ;;
  *.tar.gz) mkdir -p "$work/x" && tar -xzf "$work/$asset" -C "$work/x" ;;
  *)        mkdir -p "$work/x" && cp "$work/$asset" "$work/x/$bin_name" ;;
esac
found="$(find "$work/x" -type f -name "$bin_name" | head -n 1)"
if [ -z "$found" ]; then
  echo "::error::no $bin_name inside $asset" >&2
  exit 1
fi

mkdir -p "$root/bin"
rm -f "$root/bin/notif" "$root/bin/notif.exe"
cp "$found" "$root/bin/$bin_name"
chmod 755 "$root/bin/$bin_name"
echo "bin/$bin_name ← $NOTIF_REPO $tag $asset"
