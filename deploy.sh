#!/usr/bin/env bash
#
# deploy.sh — build super-igniting.coach and verify the analytics stack.
#
# Steps:
#   1. Production build (npm run build → dist/)
#   2. Router health check (runs on EVERY deploy — see audit task:
#      GL.iNet firmware upgrades may regenerate nginx config / drop
#      the liwan init script, silently killing analytics):
#        a) liwan.conf still present in /etc/nginx/conf.d
#        b) liwan procd service enabled & running
#        e) xray-reality service enabled & running, its nginx pass-through
#           liwan-reality.conf present, and WAN 443 still forwarded to it
#           (port 4443). Public HTTPS for stats goes WAN 443 -> Xray Reality
#           -> nginx 127.0.0.1:8446, so stats is down whenever Xray is.
#        c) TLS cert valid for > 21 days
#        d) public endpoint https://stats.igniting.coach/script.js = 200
#
# Auth for router checks (a, b, e), pick one:
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
step "2/2 Router / Liwan / Xray health check"

# (a) nginx vhost + (b, e) services — need router access
SSH_CMD=""
if [[ -n "${ROUTER_PW:-}" ]]; then SSH_CMD=(sshpass -p "$ROUTER_PW" ssh -o ConnectTimeout=8 "$ROUTER")
elif ssh -o BatchMode=yes -o ConnectTimeout=8 "$ROUTER" true 2>/dev/null; then SSH_CMD=(ssh -o BatchMode=yes "$ROUTER")
fi

if [[ -n "$SSH_CMD" ]]; then
    if "${SSH_CMD[@]}" test -s /etc/nginx/conf.d/liwan.conf; then
        ok "nginx vhost liwan.conf present"
    else
        bad "liwan.conf MISSING — restore it (likely firmware upgrade)"
    fi
    if "${SSH_CMD[@]}" /etc/init.d/liwan enabled && \
       "${SSH_CMD[@]}" pidof liwan >/dev/null; then
        ok "liwan service enabled and running"
    else
        bad "liwan service not running — try: /etc/init.d/liwan start"
    fi
    if "${SSH_CMD[@]}" /etc/init.d/xray-reality enabled && \
       "${SSH_CMD[@]}" "ps w | grep -q '[x]ray run'"; then
        ok "xray-reality service enabled and running"
    else
        bad "xray-reality not running — stats is offline; try: /etc/init.d/xray-reality start"
    fi
    if "${SSH_CMD[@]}" test -s /etc/nginx/conf.d/liwan-reality.conf; then
        ok "nginx pass-through liwan-reality.conf present"
    else
        bad "liwan-reality.conf MISSING — restore it (likely firmware upgrade)"
    fi
    FWD=$("${SSH_CMD[@]}" uci -q get firewall.liwan_https.dest_port || true)
    if [[ "$FWD" == 4443 ]]; then
        ok "WAN 443 forwarded to Xray (4443)"
    else
        bad "WAN 443 forwards to '${FWD:-nothing}', expected 4443 — try: uci set firewall.liwan_https.dest_port=4443; uci commit firewall; /etc/init.d/firewall reload"
    fi
else
    echo "   – skipped (no ROUTER_PW / ssh key); set ROUTER_PW to enable"
fi

# (c) cert expiry — public
END_DATE=$(curl -sv -o /dev/null -m 10 "$STATS_URL" 2>&1 | grep -m1 -o 'expire date: .*' | cut -d: -f2- | xargs)
DAYS=$(( ( $(date -d "$END_DATE" +%s) - $(date +%s) ) / 86400 ))
if (( DAYS > CERT_MIN_DAYS )); then ok "TLS cert valid for $DAYS more days"; else
    bad "TLS cert expires in $DAYS days — run /root/issue-cert.sh on the router"; fi

# (d) public Liwan tracker — public
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$STATS_URL/script.js")
if [[ "$CODE" == 200 ]]; then ok "public endpoint $STATS_URL/script.js → 200"; else
    bad "Liwan endpoint returned $CODE (expected 200)"; fi

# ---------------------------------------------------------------- result
echo
if (( FAIL )); then
    echo "DEPLOY CHECK FAILED — fix the ✗ items above before deploying."
    exit 1
fi
echo "All checks passed — deploy dist/ (Netlify picks it up via netlify.toml)."
