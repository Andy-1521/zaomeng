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

function normalizeFolderName(name: unknown) {
  if (typeof name !== 'string') return ''
  return name.trim().replace(/\s+/g, ' ').slice(0, 80)
}

export async function GET(request: NextRequest) {
  const userId = getCookieUserId(request)
  if (!userId) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 })
  }

  const folders = await materialFolderManager.getUserFolders(userId)
  return NextResponse.json({ success: true, data: folders })
}

export async function POST(request: NextRequest) {
  const userId = getCookieUserId(request)
  if (!userId) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 })
  }

  const body = await request.json() as { name?: string }
  const name = normalizeFolderName(body.name)
  if (!name) {
    return NextResponse.json({ success: false, error: '文件夹名称不能为空' }, { status: 400 })
  }

  try {
    const folder = await materialFolderManager.createFolder({ userId, name, sortOrder: 0 })
    return NextResponse.json({ success: true, data: folder })
  } catch (error) {
    console.error('[素材文件夹] 创建失败:', error)
    return NextResponse.json({ success: false, error: '文件夹名称可能已存在' }, { status: 400 })
  }
}

export async function PATCH(request: NextRequest) {
  const userId = getCookieUserId(request)
  if (!userId) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 })
  }

  const body = await request.json() as { id?: string; name?: string }
  const name = normalizeFolderName(body.name)
  if (!body.id || !name) {
    return NextResponse.json({ success: false, error: '缺少文件夹 ID 或名称' }, { status: 400 })
  }

  try {
    const folder = await materialFolderManager.updateFolder(body.id, userId, name)
    if (!folder) {
      return NextResponse.json({ success: false, error: '文件夹不存在' }, { status: 404 })
    }
    return NextResponse.json({ success: true, data: folder })
  } catch (error) {
    console.error('[素材文件夹] 重命名失败:', error)
    return NextResponse.json({ success: false, error: '文件夹名称可能已存在' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const userId = getCookieUserId(request)
  if (!userId) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 })
  }

  const body = await request.json() as { id?: string }
  if (!body.id) {
    return NextResponse.json({ success: false, error: '缺少文件夹 ID' }, { status: 400 })
  }

  await capturedImageManager.updateCapturedImagesByFolder(body.id, userId, { folderId: null })
  const deleted = await materialFolderManager.deleteFolder(body.id, userId)
  if (!deleted) {
    return NextResponse.json({ success: false, error: '文件夹不存在' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
