#!/bin/bash
# Package Crumbs 麵包屑 as a DMG your friends can open without warnings:
# build (Developer ID) → DMG → Apple notarization → staple the ticket.
#
# One-time setup (stores your app-specific password in the keychain; it never appears here):
#   xcrun notarytool store-credentials "crumbs-notary" --apple-id <your Apple ID> --team-id J522MVVH98
set -euo pipefail
cd "$(dirname "$0")"

PROFILE="${NOTARY_PROFILE:-crumbs-notary}"
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" Info.plist)
DMG="build.noindex/Crumbs-麵包屑-${VERSION}.dmg"

./build.sh
ID=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)
[ -n "$ID" ] || { echo "✗ No Developer ID certificate in the keychain"; exit 1; }

# DMG with the app and a shortcut to Applications (drag to install).
STAGE=$(mktemp -d)
cp -R "build.noindex/Crumbs 麵包屑.app" "$STAGE/"
ln -s /Applications "$STAGE/應用程式"
rm -f "$DMG"
hdiutil create -volname "Crumbs 麵包屑" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"
codesign --force --timestamp --sign "$ID" "$DMG"
echo "✓ $DMG"

echo "… uploading to Apple for notarization (usually 1–5 minutes)"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
spctl -a -t open --context context:primary-signature -vv "$DMG" 2>&1 | head -3
echo "✓ ready to share: $DMG"
