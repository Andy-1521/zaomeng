#!/bin/bash
set -Eeuo pipefail

cd "${COZE_WORKSPACE_PATH}"

echo "=========================================="
echo "执行部署前数据库迁移..."
echo "=========================================="

# 检查是否已安装依赖
if [ ! -d "node_modules" ]; then
  echo "⚠ 节点模块不存在，跳过迁移，将在应用启动时自动执行"
  echo "=========================================="
  exit 0
fi

# 检查环境变量文件
if [ ! -f ".env.local" ]; then
  echo "⚠ .env.local 文件不存在，跳过迁移，将在应用启动时自动执行"
  echo "=========================================="
  exit 0
fi

# 加载环境变量
echo "加载环境变量..."
export $(cat .env.local | grep -v '^#' | xargs)

# 检查 DATABASE_URL 是否设置
if [ -z "${DATABASE_URL:-}" ]; then
  echo "⚠ DATABASE_URL 未设置，跳过迁移，将在应用启动时自动执行"
  echo "=========================================="
  exit 0
fi

# 执行迁移脚本
echo "运行迁移脚本..."
node .cozeproj/scripts/run-deploy-migration.js

MIGRATION_EXIT_CODE=$?

if [ $MIGRATION_EXIT_CODE -ne 0 ]; then
  echo "=========================================="
  echo "✗ 部署前迁移失败！"
  echo "错误代码: $MIGRATION_EXIT_CODE"
  echo "=========================================="

  # 失败时不终止构建，让应用启动时的自动迁移作为后备方案
  echo "⚠ 将在应用启动时自动尝试迁移"
  echo "=========================================="
  exit 0
fi

echo "=========================================="
echo "✓ 部署前迁移完成"
echo "=========================================="
