#!/usr/bin/env bash
#
# deploy.sh - Deploy Coppice to all 3 VPSes
# Usage: ./deploy.sh [zhan|sangha|dacp|all]
#
# Uses expect for SSH (passwords have special characters).
# On each server: git pull, npm install backend, build frontend, chown dist, restart PM2.

set -euo pipefail

DEPLOY_DIR="/root/coppice"

deploy_server() {
  local name="$1"
  local host="$2"
  local password="$3"

  echo ""
  echo "============================================"
  echo "  Deploying to $name ($host)"
  echo "============================================"

  expect <<EXPECT_SCRIPT
set timeout 180
log_user 1
spawn ssh -o StrictHostKeyChecking=no root@${host}
expect "password:"
send "${password}\r"
expect -re {\\\$ $|# $}

send "cd ${DEPLOY_DIR} && echo 'CD_OK'\r"
expect -timeout 10 "CD_OK"
expect -re {\\\$ $|# $}

send "git pull origin main 2>&1 | tail -5 && echo 'GIT_PULL_OK'\r"
expect -timeout 60 "GIT_PULL_OK"
expect -re {\\\$ $|# $}

send "npm install --prefix backend --production 2>&1 | tail -3 && echo 'NPM_INSTALL_OK'\r"
expect -timeout 120 "NPM_INSTALL_OK"
expect -re {\\\$ $|# $}

send "npm run build --prefix frontend 2>&1 | tail -5 && echo 'FRONTEND_BUILD_OK'\r"
expect -timeout 120 "FRONTEND_BUILD_OK"
expect -re {\\\$ $|# $}

send "chown -R root:root frontend/dist && echo 'CHOWN_OK'\r"
expect -timeout 10 "CHOWN_OK"
expect -re {\\\$ $|# $}

send "pm2 restart coppice-backend 2>&1 | tail -5 && echo 'PM2_RESTART_OK'\r"
expect -timeout 30 "PM2_RESTART_OK"
expect -re {\\\$ $|# $}

send "sleep 3 && curl -sf http://localhost:3002/api/v1/health && echo '' && echo 'HEALTH_OK'\r"
expect -timeout 30 "HEALTH_OK"
expect -re {\\\$ $|# $}

send "exit\r"
expect eof
EXPECT_SCRIPT

  local status=$?
  if [ $status -eq 0 ]; then
    echo "[OK] $name deployed successfully"
  else
    echo "[FAIL] $name deployment failed (exit code: $status)"
  fi

  return $status
}

target="${1:-all}"

echo "Coppice Deploy - $(date)"

FAILED=0

case "$target" in
  sangha)
    deploy_server "Sangha" "149.28.117.1" 'dE4+5P}BfaSKHRvf' || FAILED=$((FAILED + 1))
    ;;
  dacp)
    deploy_server "DACP" "45.76.16.52" '3#tG![t9cG?{gWj-' || FAILED=$((FAILED + 1))
    ;;
  zhan)
    deploy_server "Zhan" "104.238.162.227" '4Cu-_fH$,?7,A*AR' || FAILED=$((FAILED + 1))
    ;;
  all)
    deploy_server "Sangha" "149.28.117.1" 'dE4+5P}BfaSKHRvf' || FAILED=$((FAILED + 1))
    deploy_server "DACP" "45.76.16.52" '3#tG![t9cG?{gWj-' || FAILED=$((FAILED + 1))
    deploy_server "Zhan" "104.238.162.227" '4Cu-_fH$,?7,A*AR' || FAILED=$((FAILED + 1))
    ;;
  *)
    echo "Usage: ./deploy.sh [zhan|sangha|dacp|all]"
    exit 1
    ;;
esac

echo ""
echo "============================================"
if [ $FAILED -eq 0 ]; then
  echo "  Deploy complete - all targets succeeded"
else
  echo "  WARNING: $FAILED target(s) failed deployment"
fi
echo "============================================"

exit $FAILED
