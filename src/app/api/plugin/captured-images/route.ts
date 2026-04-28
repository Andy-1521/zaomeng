import { NextRequest, NextResponse } from 'next/server'
import { capturedImageManager } from '@/storage/database'

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

export async function GET(request: NextRequest) {
  const userId = getCookieUserId(request)
  if (!userId) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 })
  }

  const images = await capturedImageManager.getUserCapturedImages(userId)
  return NextResponse.json({ success: true, data: images })
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
