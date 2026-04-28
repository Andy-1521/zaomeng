'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const userData = localStorage.getItem('user');
    const target = userData ? '/home' : '/login';

    queueMicrotask(() => {
      try {
        router.replace(target);
      } catch (error) {
        console.error('[RootPage] 跳转失败，使用 window.location.href:', error);
        window.location.href = target;
      }
    });
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500 mx-auto mb-4"></div>
        <p className="text-white">跳转中...</p>
      </div>
    </div>
  );
}
