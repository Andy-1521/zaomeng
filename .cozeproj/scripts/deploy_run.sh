#!/bin/bash
set -Eeuo pipefail

cd "${COZE_WORKSPACE_PATH}"

echo "=========================================="
echo "加载环境变量..."
echo "=========================================="

# 显式加载.env.local文件，确保运行时环境变量可用
if [ -f ".env.local" ]; then
  echo "加载 .env.local 文件..."
  
  # 方法1: 使用 export 直接读取（更可靠的方式）
  while IFS='=' read -r key value; do
    # 跳过注释和空行
    [[ $key =~ ^#.*$ ]] && continue
    [[ -z $key ]] && continue
    
    # 移除值周围的引号（单引号或双引号）
    value=$(echo "$value" | sed 's/^["'"'"']//' | sed 's/["'"'"']$//')
    
    # 导出环境变量
    export "$key=$value"
  done < .env.local
  
  echo "环境变量已加载"
  echo "  ENABLE_PSD_GENERATION=${ENABLE_PSD_GENERATION:-未设置}"
  echo "  RUNNINGHUB_API_KEY=${RUNNINGHUB_API_KEY:+已设置}"
  echo "  COZE_BUCKET_NAME=${COZE_BUCKET_NAME:-未设置}"
else
  echo "⚠ 警告：.env.local 文件不存在"
fi

echo "=========================================="

start_service() {
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    # 确保环境变量传递给子进程
    exec pnpm run start --port ${DEPLOY_RUN_PORT}
}

start_service
