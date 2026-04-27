#!/bin/bash
set -Eeuo pipefail

cd "${COZE_WORKSPACE_PATH}"

kill_port_if_listening() {
    local pids
    pids=$(ss -H -lntp 2>/dev/null | awk -v port="${DEPLOY_RUN_PORT}" '$4 ~ ":"port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true)
    if [[ -z "${pids}" ]]; then
      echo "Port ${DEPLOY_RUN_PORT} is free."
      return
    fi
    echo "Port ${DEPLOY_RUN_PORT} in use by PIDs: ${pids} (SIGKILL)"
    echo "${pids}" | xargs -I {} kill -9 {}
    sleep 1
    pids=$(ss -H -lntp 2>/dev/null | awk -v port="${DEPLOY_RUN_PORT}" '$4 ~ ":"port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true)
    if [[ -n "${pids}" ]]; then
      echo "Warning: port ${DEPLOY_RUN_PORT} still busy after SIGKILL, PIDs: ${pids}"
    else
      echo "Port ${DEPLOY_RUN_PORT} cleared."
    fi
}

start_service() {
    cd "${COZE_WORKSPACE_PATH}"

    # 显式加载.env.local环境变量
    if [ -f "${COZE_WORKSPACE_PATH}/.env.local" ]; then
        echo "加载环境变量: ${COZE_WORKSPACE_PATH}/.env.local"
        export $(grep -v '^#' "${COZE_WORKSPACE_PATH}/.env.local" | xargs)
    fi

    # 从 coze_workload_identity 获取数据库环境变量
    echo "从 coze_workload_identity 获取数据库配置..."
    PGDATABASE_URL=$(python3 -c "
from coze_workload_identity import Client
client = Client()
env_vars = client.get_project_env_vars()
for env_var in env_vars:
    if env_var.key == 'PGDATABASE_URL':
        print(env_var.value)
        break
client.close()
" 2>/dev/null)
    if [ -n "$PGDATABASE_URL" ]; then
        export PGDATABASE_URL
        echo "数据库配置已加载"
    else
        echo "警告: 无法获取数据库配置"
    fi

    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for dev..."
    pnpm run dev --port ${DEPLOY_RUN_PORT}
}

echo "Clearing port ${DEPLOY_RUN_PORT} before start."
kill_port_if_listening
echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for dev..."
start_service
