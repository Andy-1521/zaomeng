import { NextRequest, NextResponse } from 'next/server';
import { marketManager, userManager } from '@/storage/database';
import { getCookieUserId } from '@/lib/serverAuth';
import { inspectMarketPsdFromUrl } from '@/lib/marketPsd';

export async function POST(request: NextRequest) {
  try {
    const userId = getCookieUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    const body = await request.json() as { itemId?: string };
    if (!body.itemId) {
      return NextResponse.json({ success: false, message: '缺少素材 ID' }, { status: 400 });
    }

    const item = await marketManager.getItemById(body.itemId, userId);
    if (!item) {
      return NextResponse.json({ success: false, message: '素材不存在' }, { status: 404 });
    }
    if (!item.psdUrl) {
      return NextResponse.json({ success: false, message: '该素材不包含 PSD' }, { status: 404 });
    }

    const user = await userManager.getUserById(userId);
    const canInspect = user?.isAdmin || item.sellerId === userId || item.purchased || item.status === 'approved';
    if (!canInspect) {
      return NextResponse.json({ success: false, message: '无权查看该 PSD 预览' }, { status: 403 });
    }

    if (item.psdLayers && item.psdLayers.length > 0) {
      return NextResponse.json({ success: true, data: item });
    }

    const inspected = await inspectMarketPsdFromUrl(item.psdUrl, {
      keyPrefix: `market/psd-preview/${item.id}/${Date.now()}/layers`,
    });
    const updatedItem = await marketManager.updatePsdPreview(item.id, {
      psdLayerCount: inspected.layerCount,
      psdLayers: inspected.layers,
    }, userId);

    return NextResponse.json({ success: true, data: updatedItem });
  } catch (error) {
    console.error('[图市] PSD预览生成失败:', error);
    return NextResponse.json({ success: false, message: 'PSD 图层预览生成失败' }, { status: 500 });
  }
}
