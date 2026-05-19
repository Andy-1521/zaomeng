/**
 * 历史记录曾经走过独立的全局缓存层；当前主链已经直接使用各自模块内缓存。
 * 这里只保留兼容入口，避免旧调用点报错。
 */

export function clearCache(): void {
  // no-op
}
