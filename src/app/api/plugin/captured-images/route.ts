import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
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

type LocalMaterialPreviewRecord = {
  id?: unknown
  userId?: unknown
  imageUrl?: unknown
  originalUrl?: unknown
  pageUrl?: unknown
  pageTitle?: unknown
  sourceHost?: unknown
  imageType?: unknown
  folderId?: unknown
  isFavorite?: unknown
  createdAt?: unknown
}

type LocalMaterialPreviewFilters = ReturnType<typeof getDateRange> & {
  displayableOnly?: boolean
  isFavorite?: boolean
  folderId?: string | null
}

function normalizeLocalMaterialPreviewRecord(record: LocalMaterialPreviewRecord) {
  const id = typeof record.id === 'string' ? record.id : ''
  const imageUrl = typeof record.imageUrl === 'string' ? record.imageUrl : ''
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : ''
  if (!id || !imageUrl || !createdAt) return null

  return {
    id,
    userId: typeof record.userId === 'string' ? record.userId : 'production-preview',
    imageUrl,
    originalUrl: typeof record.originalUrl === 'string' ? record.originalUrl : null,
    pageUrl: typeof record.pageUrl === 'string' ? record.pageUrl : null,
    pageTitle: typeof record.pageTitle === 'string' ? record.pageTitle : null,
    sourceHost: typeof record.sourceHost === 'string' ? record.sourceHost : null,
    imageType: typeof record.imageType === 'string' ? record.imageType : 'main',
    folderId: typeof record.folderId === 'string' ? record.folderId : null,
    isFavorite: record.isFavorite === true || record.isFavorite === 1,
    createdAt,
  }
}

async function loadLocalMaterialPreview(
  limit: number,
  offset: number,
  filters: LocalMaterialPreviewFilters
) {
  if (process.env.NODE_ENV === 'production') return null

  try {
    const filePath = join(process.cwd(), '.cache', 'material-preview.json')
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { rows?: LocalMaterialPreviewRecord[] }
    const rows = Array.isArray(parsed.rows) ? parsed.rows : []
    const normalizedRows = rows
      .map(normalizeLocalMaterialPreviewRecord)
      .filter((record): record is NonNullable<ReturnType<typeof normalizeLocalMaterialPreviewRecord>> => Boolean(record))
      .filter((record) => {
        if (filters.displayableOnly && !isLikelyDisplayableImage(record.imageUrl)) return false
        if (typeof filters.isFavorite === 'boolean' && record.isFavorite !== filters.isFavorite) return false
        if ('folderId' in filters) {
          if (filters.folderId === null && record.folderId !== null) return false
          if (typeof filters.folderId === 'string' && record.folderId !== filters.folderId) return false
        }

        const createdAt = new Date(record.createdAt)
        if (filters.startDate && createdAt < filters.startDate) return false
        if (filters.endDate && createdAt >= filters.endDate) return false
        return true
      })
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

    const pageRows = normalizedRows.slice(offset, offset + limit)
    const data = await Promise.all(pageRows.map(async (image) => {
      const thumbnailUrl = await getAliyunOSSThumbnailUrlFromUrl(image.imageUrl, 512).catch(() => null)
      return {
        ...image,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
      }
    }))

    return {
      data,
      total: normalizedRows.length,
    }
  } catch {
    return null
  }
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

  const userId = getCookieUserId(request)
  if (!userId) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 })
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
    if (process.env.NODE_ENV !== 'production') {
      const preview = await loadLocalMaterialPreview(limit, offset, filters)
      if (preview) {
        return NextResponse.json({
          success: true,
          data: preview.data,
          pagination: {
            limit,
            offset,
            total: preview.total,
            hasMore: offset + preview.data.length < preview.total,
            nextOffset: offset + preview.data.length,
          },
          preview: true,
          message: '开发环境使用生产只读素材缓存预览',
        })
      }

      return NextResponse.json({
        success: true,
        data: [],
        pagination: {
          limit,
          offset,
          total: 0,
          hasMore: false,
          nextOffset: offset,
        },
        preview: true,
        message: '开发环境本地数据库未连接，素材库暂时无法读取；已有素材没有删除，恢复数据库后会显示',
      })
    }
    return NextResponse.json({ success: false, error: '素材库加载失败，请稍后重试' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const userId = getCookieUserId(request)
  if (!userId) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 })
  }

  const body = await request.json() as { id?: string; clearAll?: boolean; confirmDelete?: boolean }

  if (body.confirmDelete !== true) {
    return NextResponse.json({ success: false, error: '删除素材需要二次确认' }, { status: 400 })
  }

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
