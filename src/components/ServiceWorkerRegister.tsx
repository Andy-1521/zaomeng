'use client';

import { useEffect } from 'react';

/**
 * Service Worker 注册组件
 * 注意：Service Worker 已暂时禁用，因为当前不需要跨页面请求保持功能
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    console.log('[SWRegister] Service Worker 注册已暂时禁用');
  }, []);

  return null;
}
