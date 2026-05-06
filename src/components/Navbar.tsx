'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/contexts/UserContext';

interface NavbarProps {
  showUserMenu?: boolean;
}

export default function Navbar({ showUserMenu = true }: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useUser();
  const [pluginReady, setPluginReady] = useState(false);

  const handleLogoClick = () => {
    if (pathname === '/home') {
      window.location.href = '/home';
    } else {
      router.push('/home');
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string };
      if (data?.source === 'zaomeng-extension' && data.type === 'ZAOMENG_EXTENSION_READY') {
        setPluginReady(true);
      }
    };

    window.addEventListener('message', handler);
    window.postMessage({ source: 'zaomeng-web', type: 'ZAOMENG_EXTENSION_PING' }, window.location.origin);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <nav className="sticky top-0 z-40 border-b border-white/[0.08] bg-black/72 px-6 py-3 backdrop-blur-2xl shadow-[0_12px_32px_rgba(0,0,0,0.22)]">
      <div className="max-w-[92vw] 2xl:max-w-[1780px] mx-auto flex items-center justify-between">
        {/* Logo - 点击回到首页 */}
        <button
          onClick={handleLogoClick}
          className="flex items-center gap-2.5 group rounded-full px-2 py-1 transition-colors hover:bg-white/[0.04]"
        >
          <img
            src="/assets/32.png"
            alt="Logo"
            className="w-8 h-8 rounded-lg object-cover border border-purple-500/30"
          />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent group-hover:from-purple-300 group-hover:to-blue-300 transition-all">
            造梦AI
          </h1>
        </button>

        {/* 右侧用户菜单 */}
        {showUserMenu && user && (
          <div className="flex items-center gap-3">
            <div className="relative group">
              <div className={`px-3 py-1.5 rounded-full border text-xs flex items-center gap-2 ${pluginReady ? 'bg-green-500/15 border-green-500/30 text-green-300' : 'bg-white/[0.055] border-white/10 text-white/58'}`}>
                <span className={`w-2 h-2 rounded-full ${pluginReady ? 'bg-green-400' : 'bg-white/40'}`}></span>
                插件{pluginReady ? '已连接' : '未连接'}
              </div>
              <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-white/15 bg-black/85 p-4 text-xs text-white/70 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all backdrop-blur-xl z-50">
                <p className="text-white font-medium mb-2">插件安装说明</p>
                <ol className="space-y-1 list-decimal pl-4">
                  <li>打开 `chrome://extensions/`</li>
                  <li>开启开发者模式</li>
                  <li>点击“加载已解压的扩展程序”</li>
                  <li>选择 `browser-extension/zaomeng-capture` 目录</li>
                </ol>
                <p className="mt-3 text-white/45">安装后刷新网站页面，再去淘宝/天猫页面 hover 图片采图。</p>
              </div>
            </div>

            {/* 用户头像和用户名 */}
            <button
              onClick={() => router.push('/profile')}
              className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.06] py-1 pl-1 pr-4 backdrop-blur-md transition-all hover:border-white/18 hover:bg-white/[0.12]"
            >
              <img
                src={user.avatar || '/images/avatar.png'}
                alt="用户头像"
                className="w-9 h-9 rounded-full object-cover border-2 border-purple-500/30"
              />
              <span className="text-white font-medium">{user.username}</span>
            </button>

            {/* 积分显示 */}
            <button
              type="button"
              onClick={() => router.push('/profile')}
              className="flex items-center gap-1.5 rounded-full border border-yellow-500/25 bg-yellow-500/12 px-3 py-1.5 transition-colors hover:bg-yellow-500/18"
              title="查看积分明细"
            >
              <img src="/points-icon.png" alt="积分" className="w-4 h-4" />
              <span className="text-yellow-300 text-sm">{user.points}</span>
            </button>

            {/* 退出登录按钮 */}
            <button
              onClick={handleLogout}
              className="rounded-full px-3 py-1.5 text-sm text-white/48 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              退出登录
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
