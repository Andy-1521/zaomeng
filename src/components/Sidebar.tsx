'use client';

type SidebarTabType = 'material-library';

interface SidebarProps {
  activeTab: SidebarTabType;
  onTabChange: (tab: SidebarTabType) => void;
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const tabs: Array<{ id: SidebarTabType; name: string; icon: React.ReactNode }> = [
    {
      id: 'material-library',
      name: '素材库',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
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
