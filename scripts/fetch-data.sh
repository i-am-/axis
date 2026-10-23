#!/usr/bin/env bash
#
# fetch-data.sh — download the data the natal chart page serves itself.
#
#   public/ephe/    Swiss Ephemeris files from JPL DE441, years 600–2999
#                   (planets, Moon, asteroids incl. Chiron), ~8 MB
#   public/places/  the place index, built from GeoNames cities1000
#
# Needs curl, unzip and Node 24. Downloads are kept in .cache/.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Swiss Ephemeris files"
mkdir -p public/ephe
for kind in pl mo as; do
    for century in 06 12 18 24; do
        f="se${kind}_${century}.se1"
        [[ -s public/ephe/$f ]] || curl -fsSL -o "public/ephe/$f" "https://raw.githubusercontent.com/aloistr/swisseph/master/ephe/$f"
    done
done

echo "== GeoNames cities1000"
src=.cache/geonames
mkdir -p "$src"
for f in cities1000.zip admin1CodesASCII.txt countryInfo.txt; do
    [[ -s $src/$f ]] || curl -fsSL -o "$src/$f" "https://download.geonames.org/export/dump/$f"
done
unzip -oq "$src/cities1000.zip" -d "$src"

echo "== building the place index"
node scripts/build-places.ts "$src" public/places
