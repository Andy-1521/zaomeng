'use client';

type SidebarTabType = 'color-extraction' | 'quick-create' | 'custom';

interface SidebarProps {
  activeTab: SidebarTabType;
  onTabChange: (tab: SidebarTabType) => void;
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const tabs: Array<{ id: SidebarTabType; name: string; icon: React.ReactNode }> = [
    {
      id: 'color-extraction',
      name: '彩绘提取',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      ),
    },
    {
      id: 'quick-create',
      name: '快速制作',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      id: 'custom',
      name: '个性定制',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      ),
    },
  ];

  return (
    <div className="fixed left-6 top-1/2 -translate-y-1/2 flex flex-col gap-4 px-2 py-6 z-50">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            relative flex flex-col items-center gap-2 p-3 rounded-2xl transition-all
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
