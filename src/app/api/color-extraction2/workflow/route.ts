import { NextRequest } from 'next/server';
import { POST as handlePOST } from '@/app/api/color-extraction/run/handler';

export async function POST(request: NextRequest) {
  console.info('[CompatibilityRoute] legacy color-extraction2/workflow hit', {
    pathname: request.nextUrl.pathname,
    referer: request.headers.get('referer'),
    forwardedFor: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
  });

  return handlePOST(request);
}
