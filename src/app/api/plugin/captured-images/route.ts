import { NextRequest, NextResponse } from 'next/server'
import { getCookieUserId } from '@/lib/serverAuth';
import { capturedImageManager } from '@/storage/database'
import { getAliyunOSSThumbnailUrlFromUrl } from '@/lib/aliyunOSS'

function isLikelyDisplayableImage(imageUrl: string) {
  const normalized = imageUrl.split('?')[0].toLowerCase()
  return /\.(jpg|jpeg|png|webp|gif|bmp|avif)$/.test(normalized)
}

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function getDateRange(filter: string | null, timezoneOffsetMinutes: number) {
  if (!filter || filter === 'all') return {}

  const now = new Date()
  const localNow = new Date(now.getTime() - timezoneOffsetMinutes * 60000)
  const getLocalStartAsUtc = (dayOffset: number) => new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + dayOffset) + timezoneOffsetMinutes * 60000
  )
  const todayStart = getLocalStartAsUtc(0)
  const tomorrowStart = getLocalStartAsUtc(1)
  const yesterdayStart = getLocalStartAsUtc(-1)

  if (filter === 'today') {
    return { startDate: todayStart, endDate: tomorrowStart }
  }

  if (filter === 'yesterday') {
    return { startDate: yesterdayStart, endDate: todayStart }
  }

  if (filter === 'earlier') {
    return { endDate: yesterdayStart }
  }

  return {}
}

export async function GET(request: NextRequest) {
  const userId = getCookieUserId(request)
  if (!userId) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = clampInteger(searchParams.get('limit'), 60, 1, 120)
  const offset = clampInteger(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
  const timezoneOffset = clampInteger(searchParams.get('timezoneOffset'), 0, -840, 840)
  const scope = searchParams.get('scope') || 'all'
  const dateFilter = searchParams.get('date') || 'all'
  const filters = {
    ...getDateRange(dateFilter, timezoneOffset),
    displayableOnly: true,
    ...(scope === 'favorite' ? { isFavorite: true } : {}),
    ...(scope === 'uncategorized' ? { folderId: null } : {}),
    ...(scope.startsWith('folder:') ? { folderId: scope.slice('folder:'.length) } : {}),
  }

  try {
    const [images, total] = await Promise.all([
      capturedImageManager.getUserCapturedImages(userId, { limit, offset, filters }),
      capturedImageManager.countUserCapturedImages(userId, filters),
    ])

    const displayableImages = images.filter((image) => isLikelyDisplayableImage(image.imageUrl))
    const data = await Promise.all(displayableImages.map(async (image) => {
      const thumbnailUrl = await getAliyunOSSThumbnailUrlFromUrl(image.imageUrl, 512).catch(() => null)
      return {
        ...image,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
      }
    }))

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + images.length < total,
        nextOffset: offset + images.length,
      },
    })
  } catch (error) {
    console.error('[插件图库] 加载失败:', error)
    return NextResponse.json({ success: false, error: '素材库加载失败，请稍后重试' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const userId = getCookieUserId(request)
  if (!userId) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 })
  }

  const body = await request.json() as { id?: string; clearAll?: boolean }

  if (body.clearAll) {
    const deletedCount = await capturedImageManager.clearUserCapturedImages(userId)
    return NextResponse.json({ success: true, data: { deletedCount } })
  }

  if (!body.id) {
    return NextResponse.json({ success: false, error: '缺少图片记录 ID' }, { status: 400 })
  }

  const deleted = await capturedImageManager.deleteCapturedImage(body.id, userId)
  if (!deleted) {
    return NextResponse.json({ success: false, error: '图片记录不存在' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
