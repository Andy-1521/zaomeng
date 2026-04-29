'use client';

import { useEffect, useState } from 'react';

export default function AIGeneratePage() {
  const [selectedImages, setSelectedImages] = useState<string[]>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem('capture-library:selected-images');
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed)) {
        const nextImages = parsed.filter((item) => typeof item === 'string' && item.startsWith('http'));
        queueMicrotask(() => {
          setSelectedImages(nextImages);
        });
      }
    } catch (error) {
      console.error('[AI生图] 读取图库选中图片失败:', error);
    }
  }, []);

  return (
    <div className="max-w-6xl mx-auto text-white">
      <div className="text-center mb-8">
        <h2 className="text-4xl font-bold mb-3">AI生图</h2>
        <p className="text-white/60">这是 AI 生图的独立功能页面。后续你给我后端 API 后，我会把这里接成真实生图流程。</p>
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 mb-8">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-xl font-semibold">来自采集图库的图片</h3>
            <p className="text-white/50 text-sm mt-1">当前共带入 {selectedImages.length} 张图片</p>
          </div>
        </div>

        {selectedImages.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-10 text-center text-white/45">
            当前没有从采集图库带入图片，你也可以后续在这里补充上传或重新从图库进入。
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {selectedImages.map((imageUrl, index) => (
              <div key={index} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                <img src={imageUrl} alt={`AI生图素材 ${index + 1}`} className="w-full h-auto object-cover" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20">
        <h3 className="text-xl font-semibold mb-3">下一步计划</h3>
        <ul className="space-y-2 text-white/60">
          <li>• 接入你后续提供的 AI 生图后端 API</li>
          <li>• 保持“采集图库选图进入”和“快速制作直接进入”两条入口</li>
          <li>• 将生成订单写入 AI 生图页面自己的订单记录中</li>
        </ul>
      </div>
    </div>
  );
}
