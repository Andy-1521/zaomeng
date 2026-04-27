#!/bin/bash
set -Eeuo pipefail

cd "${COZE_WORKSPACE_PATH}"

echo "Installing dependencies..."
pnpm install

echo "=========================================="
echo "加载环境变量..."
echo "=========================================="

# 显式加载.env.local文件，确保构建时环境变量可用
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
else
  echo "⚠ 警告：.env.local 文件不存在"
fi

echo "=========================================="
echo "执行部署前数据库迁移..."
echo "=========================================="

# 在构建前执行数据库迁移
bash .cozeproj/scripts/pre-deploy-migrate.sh

# 注意：即使迁移失败，也继续构建
# 应用启动时会自动重试迁移
if [ $? -ne 0 ]; then
  echo "⚠ 警告：迁移脚本执行出错，但将继续构建"
  echo "   应用启动时会自动尝试修复数据库结构"
fi

echo "=========================================="
echo "开始构建项目..."
echo "=========================================="
pnpm run build

echo "=========================================="
echo "✓ 构建完成"
echo "=========================================="
