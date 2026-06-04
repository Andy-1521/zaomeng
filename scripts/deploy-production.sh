#!/usr/bin/env bash
set -Eeuo pipefail

LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${ZAOMENG_REMOTE_HOST:-ubuntu@43.129.173.9}"
SSH_KEY="${ZAOMENG_SSH_KEY:-$HOME/.ssh/id_ed25519_tencent_zaomeng}"
REMOTE_HOME="/home/ubuntu"
REMOTE_APP="${REMOTE_HOME}/zaomeng"
SERVICE_NAME="zaomeng-web"
PUBLIC_BASE_URL="https://zaomengai.icu"
SHA="$(cd "$LOCAL_ROOT" && git rev-parse --short HEAD)"
STAMP="$(date +%Y%m%d%H%M%S)"
RELEASE_NAME="zaomeng-build-${STAMP}-${SHA}"
PREVIOUS_NAME="zaomeng-prev-${STAMP}-${SHA}"
REMOTE_RELEASE="${REMOTE_HOME}/${RELEASE_NAME}"
REMOTE_PREVIOUS="${REMOTE_HOME}/${PREVIOUS_NAME}"

ssh_cmd() {
  ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "$REMOTE_HOST" "$@"
}

remote_path_guard() {
  local path="$1"
  local pattern="$2"
  if [[ -z "$path" || "$path" != ${REMOTE_HOME}/${pattern} ]]; then
    echo "[deploy] refused unsafe remote path: ${path:-<empty>}" >&2
    exit 1
  fi
}

remote_path_guard "$REMOTE_RELEASE" "zaomeng-build-*"
remote_path_guard "$REMOTE_PREVIOUS" "zaomeng-prev-*"

cd "$LOCAL_ROOT"

echo "[deploy] local checks"
pnpm exec tsc --noEmit --pretty false --incremental false
git diff --check

echo "[deploy] production env preflight"
ssh_cmd "set -Eeuo pipefail
  test -f '${REMOTE_APP}/.env.local'
  if ! grep -q '^AUTH_COOKIE_SECRET=.' '${REMOTE_APP}/.env.local'; then
    echo '[deploy] missing AUTH_COOKIE_SECRET in production .env.local; generate a high-entropy value before deploying' >&2
    exit 1
  fi
  if grep -q '^ALLOW_LEGACY_UNSIGNED_USER_COOKIE=true' '${REMOTE_APP}/.env.local'; then
    echo '[deploy] refusing production deploy with ALLOW_LEGACY_UNSIGNED_USER_COOKIE=true' >&2
    exit 1
  fi"

echo "[deploy] create remote release: ${REMOTE_RELEASE}"
ssh_cmd "mkdir -p '$REMOTE_RELEASE'"

echo "[deploy] sync source"
rsync -az --delete \
  --exclude ".git/" \
  --exclude ".DS_Store" \
  --exclude "node_modules/" \
  --exclude ".next/" \
  --exclude ".vercel/" \
  --exclude ".env.local" \
  --exclude ".coze-logs/" \
  --exclude "public/uploads/" \
  --exclude "public/plugin-capture/" \
  --exclude "public/ai-generate/" \
  --exclude "public/material-editor/" \
  --exclude "public/color-extraction/" \
  --exclude "public/avatars/" \
  -e "ssh -i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  ./ "${REMOTE_HOST}:${REMOTE_RELEASE}/"
printf '%s\n' "$SHA" | ssh_cmd "cat > '${REMOTE_RELEASE}/.deploy-sha'"

echo "[deploy] build remote release"
ssh_cmd "set -Eeuo pipefail
  test -f '${REMOTE_APP}/.env.local'
  if ! grep -q '^AUTH_COOKIE_SECRET=.' '${REMOTE_APP}/.env.local'; then
    echo '[deploy] missing AUTH_COOKIE_SECRET in production .env.local; generate a high-entropy value before deploying' >&2
    exit 1
  fi
  if grep -q '^ALLOW_LEGACY_UNSIGNED_USER_COOKIE=true' '${REMOTE_APP}/.env.local'; then
    echo '[deploy] refusing production deploy with ALLOW_LEGACY_UNSIGNED_USER_COOKIE=true' >&2
    exit 1
  fi
  cp '${REMOTE_APP}/.env.local' '${REMOTE_RELEASE}/.env.local'
  mkdir -p '${REMOTE_RELEASE}/.coze-logs'
  for dir in public/uploads public/plugin-capture public/ai-generate public/material-editor public/color-extraction public/avatars; do
    mkdir -p '${REMOTE_RELEASE}/'\$dir
    if [ -d '${REMOTE_APP}/'\$dir ]; then
      rsync -a '${REMOTE_APP}/'\$dir/ '${REMOTE_RELEASE}/'\$dir/
    fi
  done
  cd '${REMOTE_RELEASE}'
  pnpm install --frozen-lockfile
  pnpm exec tsc --noEmit --pretty false --incremental false
  pnpm build"

echo "[deploy] switch production"
ssh_cmd "set -Eeuo pipefail
  test -d '${REMOTE_RELEASE}'
  test -f '${REMOTE_RELEASE}/.env.local'
  mkdir -p '${REMOTE_RELEASE}/.coze-logs'
  sudo systemctl stop '${SERVICE_NAME}'
  if [ -e '${REMOTE_PREVIOUS}' ]; then
    echo 'previous target already exists' >&2
    exit 1
  fi
  mv '${REMOTE_APP}' '${REMOTE_PREVIOUS}'
  mv '${REMOTE_RELEASE}' '${REMOTE_APP}'
  sudo systemctl start '${SERVICE_NAME}'
  sleep 3
  systemctl is-active '${SERVICE_NAME}'
  curl -fsS 'http://127.0.0.1:5000/api/plugin/version' >/dev/null
  curl -fsSI 'http://127.0.0.1:5000/login' >/dev/null
  curl -fsSI 'http://127.0.0.1:5000/home' >/dev/null"

echo "[deploy] public smoke"
for attempt in 1 2 3 4 5 6; do
  if curl --connect-timeout 10 -fsSI "${PUBLIC_BASE_URL}/login" >/dev/null \
    && curl --connect-timeout 10 -fsS "${PUBLIC_BASE_URL}/api/plugin/version" >/dev/null; then
    break
  fi
  if [ "$attempt" = 6 ]; then
    echo "[deploy] public smoke failed after retries" >&2
    exit 1
  fi
  sleep 5
done

echo "[deploy] prune old remote releases"
ssh_cmd "set -Eeuo pipefail
  find '${REMOTE_HOME}' -maxdepth 1 -type d -name 'zaomeng-prev-*' -printf '%T@ %p\n' \
    | sort -nr \
    | awk 'NR>1 {print \$2}' \
    | xargs -r rm -rf
  find '${REMOTE_APP}' -name '.DS_Store' -type f -delete"

echo "[deploy] production deploy completed: ${SHA}"
