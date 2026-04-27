'use client';

export default function CustomPage() {
  const modules = [
    {
      id: '1',
      title: '快速创作',
      description: '快速生成创意内容',
    },
    {
      id: '2',
      title: '个性定制',
      description: '定制专属AI功能',
    },
    {
      id: '3',
      title: '自定义参数',
      description: '调整AI生成参数，打造符合你需求的内容',
    },
    {
      id: '4',
      title: '我的定制方案',
      description: '保存和管理你的个性化设置',
    },
  ];

  return (
    <div className="flex-1 px-6 py-8 overflow-y-auto">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-white mb-4">个性定制</h2>
          <p className="text-white/60 text-lg">定制专属的AI功能，打造独一无二的体验</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((module) => (
            <div
              key={module.id}
              className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 opacity-60"
            >
              <div className="flex gap-4 h-full">
                {/* 左侧加载状态图片占位 */}
                <div className="flex-shrink-0">
                  <div className="w-32 h-full min-h-[140px] rounded-lg bg-white/10 flex items-center justify-center animate-pulse">
                    <svg className="w-8 h-8 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                </div>

                {/* 右侧内容 */}
                <div className="flex-1 flex flex-col justify-between min-h-[140px]">
                  <div>
                    <h3 className="text-2xl font-semibold text-white/40 mb-2">
                      待开发...
                    </h3>
                    <p className="text-base text-white/30">
                      敬请期待
                    </p>
                  </div>

                  <div>
                    <button
                      disabled
                      className="w-full py-2 rounded-lg font-medium bg-white/5 text-white/30 cursor-not-allowed transition-all"
                    >
                      待开发
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
