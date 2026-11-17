#!/usr/bin/env bash
# Signed coaching agreements, from private storage (Netlify Blobs, store
# "signed-contracts"; written by src/pages/api/contract.ts). The key of each
# one is in its Netlify Forms submission (form "contract", field contract_file).
#
#   contract/signed.sh                     list them
#   contract/signed.sh KEY [OUT.pdf]       download one
#
# Needs a one-time `npx netlify-cli login`.
set -euo pipefail
export NETLIFY_SITE_ID=153f9f17-9f1b-40b6-a894-8134bf5074f7   # igniting-coach
STORE=signed-contracts

if (( $# == 0 )); then
  npx -y netlify-cli blobs:list "$STORE"
else
  out="${2:-$(basename "$1")}"
  npx -y netlify-cli blobs:get "$STORE" "$1" --output "$out"
  echo "saved $out"
fi
