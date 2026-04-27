/**
 * 应用启动初始化
 *
 * 在应用启动时自动检查并执行必要的数据库迁移
 * 确保数据库结构与代码同步
 */

import { checkMigrationNeeded, autoMigrate } from "./db-init";
import { initializeDatabase } from "@/storage/database/init-db";

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * 执行应用初始化
 *
 * 这个函数会在应用启动时自动调用一次
 * 确保数据库表结构与代码定义的 schema 一致
 */
export async function initializeApp() {
  // 防止重复初始化（包括构建时的多次调用）
  if (isInitialized) {
    return;
  }

  // 如果已经有初始化在进行中，等待它完成
  if (initializationPromise) {
    return initializationPromise;
  }

  // 创建初始化 Promise
  initializationPromise = (async () => {
    try {
      console.log("[App Init] 开始应用初始化检查...");

      await initializeDatabase();

      // 检查是否需要迁移
      const { needed, reason } = await checkMigrationNeeded();

      if (needed) {
        console.log(`[App Init] 检测到需要迁移: ${reason}`);

        // 执行自动迁移
        const result = await autoMigrate();

        if (result.success) {
          console.log("[App Init] ✓ 迁移执行成功:", result.message);
        } else {
          console.error("[App Init] ✗ 迁移执行失败:", result.message);
          // 不抛出错误，允许应用继续运行
          // 管理员可以通过 debug API 手动执行迁移
        }
      } else {
        console.log("[App Init] ✓ 数据库结构正常，无需迁移");
      }

      isInitialized = true;
      console.log("[App Init] 初始化检查完成");

    } catch (error) {
      // 捕获初始化错误，避免影响应用启动
      console.error("[App Init] 初始化过程中发生错误:", error);
      console.error("[App Init] 应用将继续运行，但某些功能可能受影响");
      console.error("[App Init] 请检查日志并手动执行迁移: /api/debug/run-migrations");

      // 标记为已初始化，避免重复尝试
      isInitialized = true;
    } finally {
      // 清除 Promise 引用
      initializationPromise = null;
    }
  })();

  return initializationPromise;
}

/**
 * 触发应用初始化（在应用启动时调用）
 *
 * 注意：这个函数是异步的，但不等待完成
 * 这是为了避免阻塞应用启动
 */
export function triggerInitialization() {
  // 立即触发初始化，但不等待完成
  initializeApp().catch(error => {
    console.error("[App Init] 未捕获的初始化错误:", error);
  });
}
