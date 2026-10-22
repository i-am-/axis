#!/usr/bin/env bash
#
# deploy.sh — build super-igniting.coach and verify the analytics stack.
#
# Steps:
#   1. Production build (npm run build → dist/)
#   2. Router health check (runs on EVERY deploy — see audit task:
#      GL.iNet firmware upgrades may regenerate nginx config / drop
#      the goatcounter init script, silently killing analytics):
#        a) goatcounter.conf still present in /etc/nginx/conf.d
#        b) goatcounter procd service enabled & running
#        c) TLS cert valid for > 21 days
#        d) public endpoint https://stats.igniting.coach/count.js = 200
#
# Auth for router checks (a, b), pick one:
#   - export ROUTER_PW='...'   (uses sshpass)
#   - or install a key:  ssh-copy-id root@192.168.8.1
# Checks c, d always run (public, no auth needed).

set -euo pipefail

SITE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROUTER="root@192.168.8.1"
STATS_URL="https://stats.igniting.coach"
CERT_MIN_DAYS=21
FAIL=0

step() { printf '\n== %s\n' "$1"; }
ok()   { printf '   ✓ %s\n' "$1"; }
bad()  { printf '   ✗ %s\n' "$1"; FAIL=1; }

# ---------------------------------------------------------------- 1. build
step "1/2 Building site"
(cd "$SITE_DIR" && npm run build)
ok "dist/ regenerated"

# ---------------------------------------------------------------- 2. router
step "2/2 Router / GoatCounter health check"

# (a) nginx vhost + (b) service — need router access
SSH_CMD=""
if [[ -n "${ROUTER_PW:-}" ]]; then SSH_CMD=(sshpass -p "$ROUTER_PW" ssh -o ConnectTimeout=8 "$ROUTER")
elif ssh -o BatchMode=yes -o ConnectTimeout=8 "$ROUTER" true 2>/dev/null; then SSH_CMD=(ssh -o BatchMode=yes "$ROUTER")
fi

if [[ -n "$SSH_CMD" ]]; then
    if "${SSH_CMD[@]}" test -s /etc/nginx/conf.d/goatcounter.conf; then
        ok "nginx vhost goatcounter.conf present"
    else
        bad "goatcounter.conf MISSING — restore it (likely firmware upgrade)"
    fi
    if "${SSH_CMD[@]}" /etc/init.d/goatcounter enabled && \
       "${SSH_CMD[@]}" pidof goatcounter >/dev/null; then
        ok "goatcounter service enabled and running"
    else
        bad "goatcounter service not running — try: /etc/init.d/goatcounter start"
    fi
else
    echo "   – skipped (no ROUTER_PW / ssh key); set ROUTER_PW to enable"
fi

# (c) cert expiry — public
END_DATE=$(curl -sv -o /dev/null -m 10 "$STATS_URL" 2>&1 | grep -m1 -o 'expire date: .*' | cut -d: -f2- | xargs)
DAYS=$(( ( $(date -d "$END_DATE" +%s) - $(date +%s) ) / 86400 ))
if (( DAYS > CERT_MIN_DAYS )); then ok "TLS cert valid for $DAYS more days"; else
    bad "TLS cert expires in $DAYS days — run /root/issue-cert.sh on the router"; fi

# (d) public count endpoint — public
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$STATS_URL/count.js")
if [[ "$CODE" == 200 ]]; then ok "public endpoint $STATS_URL/count.js → 200"; else
    bad "public endpoint returned $CODE (expected 200)"; fi

# ---------------------------------------------------------------- result
echo
if (( FAIL )); then
    echo "DEPLOY CHECK FAILED — fix the ✗ items above before deploying."
    exit 1
fi
echo "All checks passed — deploy dist/ (Netlify picks it up via netlify.toml)."
