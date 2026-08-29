#!/usr/bin/env bash
# setup-pubky-binaries.sh
# Downloads pre-built pubky-core-ffi native binaries from GitHub releases and
# places them where the Expo native module expects to find them.
#
# Usage:
#   bash scripts/setup-pubky-binaries.sh [--version x.y.z]
#
# Environment:
#   PUBKY_FFI_VERSION — override the release tag (default: latest)

set -euo pipefail

REPO="pubky/pubky-core-ffi"
VERSION="${PUBKY_FFI_VERSION:-}"
IOS_DEST="modules/pubky-core/ios/Frameworks"
ANDROID_AAR_DEST="modules/pubky-core/android/libs"
ANDROID_JNI_DEST="modules/pubky-core/android/src/main/jniLibs"

# ── helpers ──────────────────────────────────────────────────────────────────

require() { command -v "$1" &>/dev/null || { echo "ERROR: $1 is required but not installed." >&2; exit 1; }; }
require curl
require jq
require unzip

# ── resolve version ───────────────────────────────────────────────────────────

if [[ -z "$VERSION" ]]; then
  echo "→ Resolving latest release for $REPO …"
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | jq -r '.tag_name')
  echo "  latest = $VERSION"
fi

BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"

# ── iOS XCFramework ───────────────────────────────────────────────────────────

IOS_ASSET="PubkyCore.xcframework.zip"
IOS_URL="${BASE_URL}/${IOS_ASSET}"

echo ""
echo "→ Downloading iOS XCFramework ($VERSION) …"
curl -fL --progress-bar "$IOS_URL" -o "/tmp/${IOS_ASSET}"

echo "→ Extracting to ${IOS_DEST}/ …"
rm -rf "${IOS_DEST}/PubkyCore.xcframework"
unzip -q "/tmp/${IOS_ASSET}" -d "$IOS_DEST"
rm "/tmp/${IOS_ASSET}"
echo "✓ iOS XCFramework installed."

# ── Android AAR + JNI libs ────────────────────────────────────────────────────

ANDROID_ASSET="pubkycore-android.zip"
ANDROID_URL="${BASE_URL}/${ANDROID_ASSET}"

echo ""
echo "→ Downloading Android binaries ($VERSION) …"
curl -fL --progress-bar "$ANDROID_URL" -o "/tmp/${ANDROID_ASSET}"

echo "→ Extracting to ${ANDROID_AAR_DEST}/ and ${ANDROID_JNI_DEST}/ …"
TMP_ANDROID="/tmp/pubkycore-android"
rm -rf "$TMP_ANDROID"
unzip -q "/tmp/${ANDROID_ASSET}" -d "$TMP_ANDROID"

# AAR
if [[ -f "${TMP_ANDROID}/pubkycore.aar" ]]; then
  cp "${TMP_ANDROID}/pubkycore.aar" "${ANDROID_AAR_DEST}/pubkycore.aar"
fi

# JNI .so files per ABI
for ABI in arm64-v8a x86_64; do
  SRC="${TMP_ANDROID}/jniLibs/${ABI}/libpubkycore.so"
  if [[ -f "$SRC" ]]; then
    mkdir -p "${ANDROID_JNI_DEST}/${ABI}"
    cp "$SRC" "${ANDROID_JNI_DEST}/${ABI}/libpubkycore.so"
  fi
done

rm -rf "$TMP_ANDROID" "/tmp/${ANDROID_ASSET}"
echo "✓ Android binaries installed."

echo ""
echo "All pubky-core-ffi binaries installed for version ${VERSION}."
echo "You can now run 'expo prebuild' and build the app."
