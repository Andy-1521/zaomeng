#!/bin/bash
# 环境变量验证脚本
# 用于验证 .env.local 文件是否正确加载

set -Eeuo pipefail

cd "${COZE_WORKSPACE_PATH}"

echo "=========================================="
echo "环境变量验证工具"
echo "=========================================="

# 检查 .env.local 文件是否存在
if [ ! -f ".env.local" ]; then
  echo "✗ 错误：.env.local 文件不存在"
  echo "请确保 .env.local 文件已创建并包含正确的环境变量"
  exit 1
fi

echo "✓ .env.local 文件存在"

# 加载环境变量
echo ""
echo "加载环境变量..."
while IFS='=' read -r key value; do
  # 跳过注释和空行
  [[ $key =~ ^#.*$ ]] && continue
  [[ -z $key ]] && continue
  
  # 移除值周围的引号（单引号或双引号）
  value=$(echo "$value" | sed 's/^["'"'"']//' | sed 's/["'"'"']$//')
  
  # 导出环境变量
  export "$key=$value"
done < .env.local

echo "✓ 环境变量已加载"

# 验证关键环境变量
echo ""
echo "验证关键环境变量..."

ERRORS=0

# 检查 ENABLE_PSD_GENERATION
if [ "${ENABLE_PSD_GENERATION}" = "true" ]; then
  echo "✓ ENABLE_PSD_GENERATION: ${ENABLE_PSD_GENERATION}"
else
  echo "✗ ENABLE_PSD_GENERATION: ${ENABLE_PSD_GENERATION:-未设置} (应为 true)"
  ERRORS=$((ERRORS + 1))
fi

# 检查 RUNNINGHUB_API_KEY
if [ -n "${RUNNINGHUB_API_KEY}" ]; then
  echo "✓ RUNNINGHUB_API_KEY: 已设置 (长度: ${#RUNNINGHUB_API_KEY})"
else
  echo "✗ RUNNINGHUB_API_KEY: 未设置"
  ERRORS=$((ERRORS + 1))
fi

# 检查 COZE_BUCKET_NAME
if [ -n "${COZE_BUCKET_NAME}" ]; then
  echo "✓ COZE_BUCKET_NAME: ${COZE_BUCKET_NAME}"
else
  echo "✗ COZE_BUCKET_NAME: 未设置"
  ERRORS=$((ERRORS + 1))
fi

# 检查 COZE_BUCKET_ENDPOINT_URL
if [ -n "${COZE_BUCKET_ENDPOINT_URL}" ]; then
  echo "✓ COZE_BUCKET_ENDPOINT_URL: ${COZE_BUCKET_ENDPOINT_URL}"
else
  echo "✗ COZE_BUCKET_ENDPOINT_URL: 未设置"
  ERRORS=$((ERRORS + 1))
fi

# 检查 COZE_ACCESS_KEY
if [ -n "${COZE_ACCESS_KEY}" ]; then
  echo "✓ COZE_ACCESS_KEY: 已设置 (长度: ${#COZE_ACCESS_KEY})"
else
  echo "✗ COZE_ACCESS_KEY: 未设置"
  ERRORS=$((ERRORS + 1))
fi

# 检查 COZE_SECRET_KEY
if [ -n "${COZE_SECRET_KEY}" ]; then
  echo "✓ COZE_SECRET_KEY: 已设置 (长度: ${#COZE_SECRET_KEY})"
else
  echo "✗ COZE_SECRET_KEY: 未设置"
  ERRORS=$((ERRORS + 1))
fi

echo ""
echo "=========================================="
if [ ${ERRORS} -eq 0 ]; then
  echo "✓ 所有环境变量验证通过"
  echo "=========================================="
  exit 0
else
  echo "✗ 发现 ${ERRORS} 个配置错误"
  echo "请修复上述错误后再部署"
  echo "=========================================="
  exit 1
fi
