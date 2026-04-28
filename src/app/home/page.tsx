'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@/contexts/UserContext';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import TaskHistory from '@/components/TaskHistory';
import { TabType } from '@/components/TaskHistory';
import ColorExtraction2Page from '@/components/ColorExtraction2Page';
import QuickCreatePage from '@/components/QuickCreatePage';
import CustomPage from '@/components/CustomPage';

type SidebarTab = 'color-extraction' | 'quick-create' | 'custom';

export default function HomePage() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading, refreshUser } = useUser();
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('color-extraction');

  // Sidebar tab -> TaskHistory TabType mapping
  const getTaskHistoryTab = (): TabType => {
    if (sidebarTab === 'color-extraction') return 'color-extraction';
    if (sidebarTab === 'quick-create') return 'auto-remove-bg';
    return 'custom';
  };

  // 监听路由变化
  useEffect(() => {
    if (pathname === '/home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [pathname]);

  useEffect(() => {
    // 等待 UserContext 从 localStorage 初始化完成
    if (isLoading) return;

    if (!user) {
      queueMicrotask(() => {
        router.replace('/login');
      });
      return;
    }

    // 首次加载时从服务器刷新用户信息（确保积分是最新的）
    refreshUser();

    fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    }).catch(err => {
      console.error('刷新会话失败:', err);
    });

    // 窗口获得焦点时刷新用户信息
    const handleFocus = () => {
      refreshUser();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [isLoading, refreshUser, router, user]);

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
        <div className="absolute top-1/4 left-1/4 w-[800px] h-[800px] bg-purple-600/12 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[700px] h-[700px] bg-blue-600/12 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1.5s' }} />
      </div>

      {/* 主内容 */}
      <div className="relative z-10">
        {/* 导航栏 */}
        <Navbar />

        {/* 左侧导航栏 */}
        <Sidebar activeTab={sidebarTab} onTabChange={setSidebarTab} />

        {/* 右侧任务历史 */}
        <TaskHistory activeTab={getTaskHistoryTab()} userId={user?.id} />

        {/* 主要内容区 */}
        <div className="pl-20 pr-28">
          {sidebarTab === 'color-extraction' && (
            <ColorExtraction2Page key="color-extraction" />
          )}

          {sidebarTab === 'quick-create' && (
            <QuickCreatePage key="quick-create" />
          )}

          {sidebarTab === 'custom' && (
            <CustomPage key="custom" />
          )}
        </div>
      </div>
    </div>
  );
}
