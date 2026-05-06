import { NextRequest, NextResponse } from 'next/server'
import { capturedImageManager, materialFolderManager } from '@/storage/database'

function getCookieUserId(request: NextRequest): string | null {
  const userCookie = request.cookies.get('user')
  if (!userCookie) return null

  try {
    const userData = JSON.parse(userCookie.value) as { id?: string }
    return typeof userData.id === 'string' && userData.id ? userData.id : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const userId = getCookieUserId(request)
  if (!userId) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 })
  }

  const body = await request.json() as {
    ids?: string[]
    folderId?: string | null
    isFavorite?: boolean
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string' && id) : []
  if (ids.length === 0) {
    return NextResponse.json({ success: false, error: '请选择要更新的素材' }, { status: 400 })
  }

  if (typeof body.folderId === 'string') {
    const folder = await materialFolderManager.getFolderById(body.folderId, userId)
    if (!folder) {
      return NextResponse.json({ success: false, error: '文件夹不存在' }, { status: 404 })
    }
  }

  const updates: { folderId?: string | null; isFavorite?: boolean } = {}
  if ('folderId' in body) {
    updates.folderId = body.folderId || null
  }
  if (typeof body.isFavorite === 'boolean') {
    updates.isFavorite = body.isFavorite
  }

  const updatedCount = await capturedImageManager.updateCapturedImages(ids, userId, updates)
  return NextResponse.json({ success: true, data: { updatedCount } })
}
