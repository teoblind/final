#!/bin/bash
# Deploy Coppice to all 3 VPS servers
# Usage: ./deploy.sh [zhan|sangha|dacp|all]

set -e

ZHAN_VPS="root@104.238.162.227"
SANGHA_VPS="root@149.28.117.1"
DACP_VPS="root@45.76.16.52"

DEPLOY_CMD='cd /root/coppice && git pull origin main && cd frontend && npm run build 2>&1 | tail -3 && cd .. && pm2 restart coppice-backend && echo "DEPLOY OK"'

deploy_one() {
  local name=$1
  local host=$2
  echo "--- Deploying to $name ($host) ---"
  ssh -o ConnectTimeout=10 "$host" "$DEPLOY_CMD" 2>&1
  echo ""
}

target="${1:-all}"

case "$target" in
  zhan)
    deploy_one "Zhan" "$ZHAN_VPS"
    ;;
  sangha)
    deploy_one "Sangha" "$SANGHA_VPS"
    ;;
  dacp)
    deploy_one "DACP" "$DACP_VPS"
    ;;
  all)
    deploy_one "Zhan" "$ZHAN_VPS"
    deploy_one "Sangha" "$SANGHA_VPS"
    deploy_one "DACP" "$DACP_VPS"
    ;;
  *)
    echo "Usage: ./deploy.sh [zhan|sangha|dacp|all]"
    exit 1
    ;;
esac

echo "=== Deploy complete ==="
