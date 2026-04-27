'use client';

import { useEffect } from 'react';
import { taskEventHandler } from '@/lib/taskEventHandler';

/**
 * 全局事件处理器初始化组件
 *
 * 功能说明：
 * - 在页面加载时初始化全局任务事件处理器
 * - 独立于所有组件，确保切换页面后仍能处理任务事件
 */
export function GlobalEventHandler() {
  useEffect(() => {
    // 初始化全局事件处理器
    taskEventHandler.initialize();

    console.log('[GlobalEventHandler] 全局事件处理器已初始化');
  }, []);

  return null; // 不渲染任何内容
}
