#!/bin/sh
# Builds Melo.app into ~/Applications: the Swift shell plus the UI bundled into its Resources.
# MELO_APP changes where the app goes, MELO_VERSION sets its version, and MELO_UNIVERSAL=1 builds for both
# Apple silicon and Intel (this needs full Xcode, not just the Command Line Tools). scripts/package.sh uses all three.
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
app="${MELO_APP:-$HOME/Applications/Melo.app}"
version="${MELO_VERSION:-0.1}"
arch=""
if [ "${MELO_UNIVERSAL:-}" = 1 ]; then arch="--arch arm64 --arch x86_64"; fi

# Vite 8 needs Node 20.19+ or 22.12+.
node_ok=$(node -p 'const [a, b] = process.versions.node.split(".").map(Number); a > 22 || (a === 22 && b >= 12) || (a === 20 && b >= 19)' 2>/dev/null || echo false)
if [ "$node_ok" != true ]; then
  echo "Melo needs Node 20.19+ or 22.12+ to build its UI (found: $(node -v 2>/dev/null || echo none))." >&2
  exit 1
fi

(cd "$repo/ui" && npm ci --silent && npm run --silent build)
# $arch is deliberately unquoted: it is empty or two flag pairs.
swift build --package-path "$repo" -c release --product Melo $arch
bin=$(swift build --package-path "$repo" -c release $arch --show-bin-path)

rm -rf "$app"
mkdir -p "$(dirname "$app")" "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin/Melo" "$app/Contents/MacOS/Melo"
cp -R "$repo/ui/dist" "$app/Contents/Resources/ui"
# The player scripts (Sources/Melo/Resources), found by Bundle.module under Contents/Resources.
cp -R "$bin/Melo_Melo.bundle" "$app/Contents/Resources/"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Melo</string>
  <key>CFBundleIdentifier</key><string>com.charlieadam.melo</string>
  <key>CFBundleExecutable</key><string>Melo</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --sign - "$app"
echo "Built $app"
