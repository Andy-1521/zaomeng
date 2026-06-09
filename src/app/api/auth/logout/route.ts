import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, getClearAuthCookieOptions } from '@/lib/serverAuth';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true, message: '已退出登录' });
  response.cookies.set(AUTH_COOKIE_NAME, '', getClearAuthCookieOptions(request));
  return response;
}
