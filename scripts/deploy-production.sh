#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="/home/ubuntu/Downloads/zaomeng/project/projects"
SERVICE_NAME="zaomeng-web"
PUBLIC_BASE_URL="http://124.223.26.206"

cd "$PROJECT_ROOT"

echo "[deploy] stopping service: ${SERVICE_NAME}"
sudo systemctl stop "$SERVICE_NAME"

echo "[deploy] removing old .next build artifacts"
rm -rf .next

echo "[deploy] building production assets"
pnpm build

echo "[deploy] starting service: ${SERVICE_NAME}"
sudo systemctl start "$SERVICE_NAME"

echo "[deploy] waiting for service warmup"
sleep 5

echo "[deploy] checking key public pages"
curl -fsSI "${PUBLIC_BASE_URL}/login" >/dev/null
curl -fsSI "${PUBLIC_BASE_URL}/" >/dev/null
curl -fsSI "${PUBLIC_BASE_URL}/home" >/dev/null

echo "[deploy] running browser smoke check"
pnpm exec node tmp/check-pages.js >/tmp/zaomeng-deploy-check.log
cat /tmp/zaomeng-deploy-check.log

if grep -E "HTTPERR: (404|500) http://124\.223\.26\.206/_next/static/chunks/" /tmp/zaomeng-deploy-check.log >/dev/null; then
  echo "[deploy] chunk validation failed"
  exit 1
fi

if grep -E "PAGEERROR:" /tmp/zaomeng-deploy-check.log >/dev/null; then
  echo "[deploy] browser page error detected"
  exit 1
fi

echo "[deploy] production deploy completed successfully"
