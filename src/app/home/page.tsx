'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@/contexts/UserContext';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import TaskHistory from '@/components/TaskHistory';
import QuickCreatePage from '@/components/QuickCreatePage';

export default function HomePage() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, refreshUser } = useUser();

  // 监听路由变化
  useEffect(() => {
    if (pathname === '/home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [pathname]);

  useEffect(() => {
    if (isLoading || user?.id) return;

    queueMicrotask(() => {
      router.replace('/login');
    });
  }, [isLoading, router, user?.id]);

  useEffect(() => {
    if (isLoading || !user?.id) return;

    void refreshUser();

    void fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    }).catch(err => {
      console.error('刷新会话失败:', err);
    });
  }, [isLoading, refreshUser, user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const handleFocus = () => {
      void refreshUser();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [refreshUser, user?.id]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500 mx-auto mb-4"></div>
          <p>{isLoading ? '加载中...' : '正在跳转到登录页...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* 动态背景 */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-900 to-black" />
        <div className="absolute top-1/4 left-1/4 h-[800px] w-[800px] animate-pulse rounded-full bg-purple-600/12 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 h-[700px] w-[700px] animate-pulse rounded-full bg-blue-600/12 blur-[120px]" style={{ animationDelay: '1.5s' }} />
        <div className="absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-indigo-600/8 blur-[120px]" style={{ animationDelay: '2.5s' }} />
        <div className="absolute right-20 top-20 h-96 w-96 rounded-full bg-gradient-to-br from-purple-500/10 via-pink-500/10 to-blue-500/10 blur-[100px]" />
        <div className="absolute bottom-20 left-20 h-96 w-96 rounded-full bg-gradient-to-br from-blue-500/10 via-cyan-500/10 to-purple-500/10 blur-[100px]" />
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: `
            linear-gradient(rgba(147, 51, 234, 0.2) 1px, transparent 1px),
            linear-gradient(90deg, rgba(147, 51, 234, 0.2) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }} />
      </div>

      {/* 主内容 */}
      <div className="relative z-10">
        {/* 导航栏 */}
        <Navbar />

        {/* 左侧导航栏 */}
        <Sidebar activeTab="material-library" onTabChange={() => undefined} />

        {/* 右侧任务历史 */}
        <TaskHistory activeTab="color-extraction" userId={user?.id} />

        {/* 主要内容区 */}
        <div className="px-3 pb-28 sm:pl-20 sm:pr-28 sm:pb-0">
          <QuickCreatePage />
        </div>
      </div>
    </div>
  );
}
