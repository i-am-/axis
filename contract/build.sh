#!/usr/bin/env bash
# Builds the coaching agreement: the torch-bearer emblem and the faint map from the site's own
# figure data, then the contract with LuaLaTeX (two runs, for the page frame
# and "page x of y"), into public/contract/coaching-agreement.pdf.
# Needs: node (24+), rsvg-convert, lualatex, and the fonts EB Garamond 12,
# Cormorant Garamond and Cinzel installed on this machine.
set -euo pipefail
cd "$(dirname "$0")"

node torch-svg.mjs
rsvg-convert -f pdf -o build/torchbearer.pdf build/torchbearer.svg
node map-svg.mjs
rsvg-convert -f pdf -o build/map.pdf build/map.svg
for _ in 1 2; do
  lualatex -interaction=nonstopmode -halt-on-error -output-directory=build coaching-agreement.tex > build/lualatex.log
done
mkdir -p ../public/contract
cp build/coaching-agreement.pdf ../public/contract/coaching-agreement.pdf
echo "public/contract/coaching-agreement.pdf: $(qpdf --show-npages build/coaching-agreement.pdf) pages"

# The face the signing page stamps names and dates in (src/lib/contract-sign.ts):
# Inter Light, as in the agreement, cut down by fonttools to Latin, Latin
# Extended and Cyrillic, which pdf-lib's font reader handles cleanly.
pyftsubset "$(fc-match -f '%{file}' 'Inter:style=Light')" \
  --unicodes="U+0020-007E,U+00A0-024F,U+0400-04FF,U+2010-2027,U+2030-203A,U+20AC" \
  --layout-features='kern' --no-hinting \
  --output-file=build/Inter-Light.otf
# pdf-lib labels every font TrueType: give it TrueType outlines to match
python3 otf2ttf.py build/Inter-Light.otf ../public/contract/Inter-Light.ttf
