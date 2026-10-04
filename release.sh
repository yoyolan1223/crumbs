#!/bin/bash
# Ship a new Mac version to friends in one go:
#   version bump → build + Developer ID sign → DMG → Apple notarization → website download → deploy → GitHub release.
#
#   ./release.sh 0.2.2
set -euo pipefail
cd "$(dirname "$0")"

NEW="${1:?usage: ./release.sh <version, e.g. 0.2.2>}"
PL=mac/Info.plist
BUILD=$(( $(/usr/libexec/PlistBuddy -c "Print CFBundleVersion" "$PL") + 1 ))
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $NEW" -c "Set :CFBundleVersion $BUILD" "$PL"
echo "→ version $NEW (build $BUILD)"

# 1. build, sign, package, notarize, staple
mac/notarize.sh
DMG="mac/build.noindex/Crumbs-麵包屑-$NEW.dmg"
spctl -a -t open --context context:primary-signature "$DMG"   # fails the release if not notarized

# 2. keep one copy to share by hand, one for the website
rm -f dist/Crumbs-麵包屑-*.dmg && cp "$DMG" dist/
rm -f site/downloads/Crumbs-*.dmg && cp "$DMG" "site/downloads/Crumbs-$NEW.dmg"

# 3. website + install guide: file names, version, size
python3 - "$NEW" "$DMG" <<'EOF'
import os, re, sys
new, dmg = sys.argv[1], sys.argv[2]
size = f"{os.path.getsize(dmg) / 1e6:.1f} MB"
for p in ('site/index.html', 'site/en/index.html'):
    s = open(p, encoding='utf-8').read()
    s = re.sub(r'downloads/Crumbs-[\d.]+\.dmg', f'downloads/Crumbs-{new}.dmg', s)
    s = re.sub(r'download="Crumbs-麵包屑-[\d.]+\.dmg"', f'download="Crumbs-麵包屑-{new}.dmg"', s)
    s = re.sub(r'\b\d+\.\d+\.\d+ · [\d.]+ MB', f'{new} · {size}', s)
    s = re.sub(r'\b\d+\.\d+\.\d+(?= · macOS)', new, s)
    s = re.sub(r'"softwareVersion":"[\d.]+"', f'"softwareVersion":"{new}"', s)
    open(p, 'w', encoding='utf-8').write(s)
g = '新手安裝說明.md'
if os.path.exists(g):
    t = open(g, encoding='utf-8').read()
    open(g, 'w', encoding='utf-8').write(re.sub(r'Crumbs-麵包屑-[\d.]+\.dmg', f'Crumbs-麵包屑-{new}.dmg', t))
print(f"→ site + guide updated ({new}, {size})")
EOF

# 4. deploy and make sure friends get exactly this file
npx --yes wrangler deploy
URL="https://crumbs.01-crumbs.workers.dev/downloads/Crumbs-$NEW.dmg"
for i in 1 2 3 4 5 6; do
  REMOTE=$(curl -s -m 60 "$URL" | shasum -a 256 | awk '{print $1}')
  [ "$REMOTE" = "$(shasum -a 256 "$DMG" | awk '{print $1}')" ] && break
  sleep 10
done
[ "$REMOTE" = "$(shasum -a 256 "$DMG" | awk '{print $1}')" ] && echo "✓ live and identical: $URL" || { echo "✗ website file differs from local DMG"; exit 1; }

# 5. GitHub: commit the version bump + site, and attach the DMG to a release
if git remote get-url origin >/dev/null 2>&1; then
  git add -A && git commit -q -m "Release $NEW" && git push -q
  cp "$DMG" "${TMPDIR:-/tmp}/Crumbs-$NEW.dmg"
  gh release create "v$NEW" "${TMPDIR:-/tmp}/Crumbs-$NEW.dmg" --title "Crumbs $NEW" --generate-notes \
    && echo "✓ GitHub release v$NEW"
fi
