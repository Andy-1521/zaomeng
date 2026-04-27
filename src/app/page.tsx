'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(true);

  useEffect(() => {
    // 检查用户是否已登录
    const userData = localStorage.getItem('user');

    const redirect = () => {
      try {
        if (userData) {
          // 用户已登录，跳转到首页
          console.log('[RootPage] 用户已登录，跳转到 /home');
          router.push('/home');
        } else {
          // 用户未登录，跳转到登录页
          console.log('[RootPage] 用户未登录，跳转到 /login');
          router.push('/login');
        }
      } catch (error) {
        console.error('[RootPage] 跳转失败，尝试使用 window.location.href:', error);
        // 如果 router.push 失败，使用 window.location.href 作为备用方案
        window.location.href = userData ? '/home' : '/login';
      }
    };

    // 延迟执行跳转，确保组件已经挂载
    const timer = setTimeout(redirect, 100);

    // 添加超时保护，如果5秒后仍未跳转，强制跳转
    const timeoutId = setTimeout(() => {
      console.error('[RootPage] 跳转超时，强制跳转到 /login');
      window.location.href = '/login';
    }, 5000);

    return () => {
      clearTimeout(timer);
      clearTimeout(timeoutId);
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="text-center">
        {isRedirecting && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500 mx-auto mb-4"></div>
            <p className="text-white">跳转中...</p>
          </>
        )}
        {!isRedirecting && (
          <button
            onClick={() => (window.location.href = '/login')}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
          >
            跳转到登录页
          </button>
        )}
      </div>
    </div>
  );
}
