#!/usr/bin/env bash
#
# fetch-symbolon.sh — put the Symbolon card scans into public/symbolon/
# before a build. They live in the private repo i-am-/symbolon-assets, not
# here: the deck art is the publisher's and this repo is public.
#
# On Netlify, set SYMBOLON_ASSETS_TOKEN to a fine-grained GitHub token with
# read access to that repo's contents. Locally, git's own credentials (gh)
# are used. Without either, the build goes on and the spread draws plates
# with the card names instead of the images.

set -euo pipefail
cd "$(dirname "$0")/.."

dest=public/symbolon
if [[ -s $dest/background.webp ]]; then
    echo "symbolon: images already in $dest"
    exit 0
fi

url=https://github.com/i-am-/symbolon-assets.git
[[ -n ${SYMBOLON_ASSETS_TOKEN:-} ]] && url="https://x-access-token:${SYMBOLON_ASSETS_TOKEN}@github.com/i-am-/symbolon-assets.git"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if GIT_TERMINAL_PROMPT=0 git clone -q --depth 1 "$url" "$tmp/assets" 2>/dev/null; then
    mkdir -p "$dest"
    cp -r "$tmp/assets/cards" "$tmp/assets/background.webp" "$dest/"
    echo "symbolon: $(find "$dest/cards" -name "*.webp" | wc -l) cards fetched"
else
    echo "symbolon: could not fetch i-am-/symbolon-assets; the spread will show card names only" >&2
fi
