'use client';

import { useRouter } from 'next/navigation';
import { useUser } from '@/contexts/UserContext';

type SidebarTabType = 'market' | 'material-library';

interface SidebarProps {
  activeTab: SidebarTabType;
  onTabChange: (tab: SidebarTabType) => void;
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const router = useRouter();
  const { user, isLoading } = useUser();
  const tabs: Array<{ id: SidebarTabType; name: string; icon: React.ReactNode }> = [
    {
      id: 'market',
      name: '图市',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 9h14l-1.2-4.2A1.2 1.2 0 0016.65 4H7.35a1.2 1.2 0 00-1.15.8L5 9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 9v1.2A2.8 2.8 0 007.8 13 2.8 2.8 0 0010.6 10.2V9M10.6 9v1.2A2.8 2.8 0 0013.4 13a2.8 2.8 0 002.8-2.8V9M16.2 9v1.2A2.8 2.8 0 0019 13" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.5 13.5V19a1 1 0 001 1h9a1 1 0 001-1v-5.5" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 18l1.8-1.8a1 1 0 011.4 0L14 18m-.8-3.7h.01" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 17.5h1.5m-.75-.75v1.5" />
        </svg>
      ),
    },
    {
      id: 'material-library',
      name: '图库',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-[1.35rem] border border-white/10 bg-black/62 px-2 py-2 shadow-[0_18px_52px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:left-6 sm:top-1/2 sm:bottom-auto sm:-translate-x-0 sm:-translate-y-1/2 sm:flex-col sm:gap-4 sm:border-0 sm:bg-transparent sm:px-2 sm:py-6 sm:shadow-none sm:backdrop-blur-none">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => {
            if (tab.id === 'material-library' && isLoading) return;
            if (tab.id === 'material-library' && !user?.id) {
              router.push('/login?next=/home');
              return;
            }
            onTabChange(tab.id);
            router.push(tab.id === 'market' ? '/market' : '/home');
          }}
          className={`
            relative flex min-w-[4.25rem] flex-col items-center gap-1.5 rounded-2xl px-3 py-2.5 transition-all sm:min-w-0 sm:gap-2 sm:p-3
            ${activeTab === tab.id
              ? 'bg-white/20 text-white backdrop-blur-xl'
              : 'text-white/60 hover:bg-white/10 hover:text-white hover:backdrop-blur-md'
            }
          `}
        >
          {tab.icon}
          <span className="text-xs font-medium">{tab.name}</span>
        </button>
      ))}
    </div>
  );
}
