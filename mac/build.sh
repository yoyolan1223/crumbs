#!/bin/bash
# Build Crumbs 麵包屑.app
#   ./build.sh            → build, signed with your Developer ID if one is in the keychain (ad-hoc otherwise)
#   INSTALL=1 ./build.sh  → also copy it to /Applications and relaunch it there
#   CODESIGN_ID="…"       → force a specific signing identity
set -euo pipefail
cd "$(dirname "$0")"

APP="build.noindex/Crumbs 麵包屑.app"   # .noindex: keeps Spotlight/Launchpad from listing this copy
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -swift-version 5 -O -target arm64-apple-macos14.0 Sources/*.swift -o "$APP/Contents/MacOS/Crumbs"
cp Info.plist "$APP/Contents/Info.plist"
cp Resources/* "$APP/Contents/Resources/"
# Main page = the Chrome extension's UI + a small bridge (web/).
mkdir -p "$APP/Contents/Resources/web"
cp web/* "$APP/Contents/Resources/web/"
cp ../shared.js ../sidepanel.css ../sidepanel.js ../dashboard.css ../dashboard.js "$APP/Contents/Resources/web/"

# A stable signature keeps macOS permissions (Accessibility) across rebuilds.
ID="${CODESIGN_ID:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"
if [ -z "$ID" ]; then
  echo "⚠️  No Developer ID found — ad-hoc signing (permissions reset on every rebuild)"
  codesign --force --sign - "$APP"
else
  codesign --force --options runtime --timestamp --entitlements Crumbs.entitlements --sign "$ID" "$APP"
  echo "✓ signed: $ID"
fi
echo "✓ $APP"

if [ "${INSTALL:-0}" = "1" ]; then
  pkill -f "Contents/MacOS/Crumbs" 2>/dev/null || true
  sleep 0.5
  rm -rf "/Applications/麵包屑.app" "/Applications/Crumbs 麵包屑.app"   # also removes the old name
  cp -R "$APP" "/Applications/Crumbs 麵包屑.app"
  open "/Applications/Crumbs 麵包屑.app"
  echo "✓ installed to /Applications and launched"
fi
