'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/contexts/UserContext';

interface NavbarProps {
  showUserMenu?: boolean;
}

export default function Navbar({ showUserMenu = true }: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useUser();

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

  return (
    <nav className="bg-black backdrop-blur-md px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo - 点击回到首页 */}
        <button
          onClick={handleLogoClick}
          className="flex items-center gap-2 group"
        >
          <img
            src="/assets/32.png"
            alt="Logo"
            className="w-8 h-8 rounded-lg object-cover border border-purple-500/30"
          />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent group-hover:from-purple-300 group-hover:to-blue-300 transition-all">
            造梦Ai
          </h1>
        </button>

        {/* 右侧用户菜单 */}
        {showUserMenu && user && (
          <div className="flex items-center gap-4">
            {/* 用户头像和用户名 */}
            <button
              onClick={() => router.push('/profile')}
              className="flex items-center gap-3 bg-white/10 backdrop-blur-md rounded-full pl-1 pr-4 py-1 border border-white/20 hover:bg-white/20 transition-all"
            >
              <img
                src={user.avatar || '/images/avatar.png'}
                alt="用户头像"
                className="w-9 h-9 rounded-full object-cover border-2 border-purple-500/30"
              />
              <span className="text-white font-medium">{user.username}</span>
            </button>

            {/* 积分显示 */}
            <div className="bg-yellow-600/20 px-3 py-1 rounded-full border border-yellow-500/30 flex items-center gap-1.5">
              <img src="/points-icon.png" alt="积分" className="w-4 h-4" />
              <span className="text-yellow-300 text-sm">{user.points}</span>
            </div>

            {/* 退出登录按钮 */}
            <button
              onClick={handleLogout}
              className="text-white/60 hover:text-white transition-colors"
            >
              退出登录
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
