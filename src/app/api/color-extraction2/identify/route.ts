import { NextRequest } from 'next/server';
import { POST as handlePOST } from '@/app/api/smart-edit/identify/handler';

export async function POST(request: NextRequest) {
  console.info('[CompatibilityRoute] legacy color-extraction2/identify hit', {
    pathname: request.nextUrl.pathname,
    referer: request.headers.get('referer'),
    forwardedFor: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
  });

  return handlePOST(request);
}
