#!/bin/sh
# Builds a universal Melo.app and zips it for a GitHub release: build/Melo-<version>.zip plus its SHA-256.
# Usage: scripts/package.sh 0.2.0
set -eu

version=${1:?usage: scripts/package.sh <version, e.g. 0.2.0>}
repo=$(cd "$(dirname "$0")/.." && pwd)
out="$repo/build"

rm -rf "$out"
MELO_APP="$out/Melo.app" MELO_VERSION="$version" MELO_UNIVERSAL=1 "$repo/scripts/build.sh"

# ditto keeps the bundle's symlinks, permissions and code signature intact, which zip does not.
zip="Melo-$version.zip"
(cd "$out" && ditto -c -k --keepParent Melo.app "$zip" && shasum -a 256 "$zip" > "$zip.sha256")
echo "Packaged $out/$zip"
