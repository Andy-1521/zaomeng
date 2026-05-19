import { NextRequest } from 'next/server';
import { POST as handlePOST } from '@/app/api/color-extraction/generate-psd/handler';

export async function POST(request: NextRequest) {
  console.info('[CompatibilityRoute] legacy color-extraction2/generate-psd hit', {
    pathname: request.nextUrl.pathname,
    referer: request.headers.get('referer'),
    forwardedFor: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
  });

  return handlePOST(request);
}
