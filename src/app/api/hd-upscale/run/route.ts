import { NextRequest } from 'next/server';
import { runHdUpscaleRoute } from '@/lib/hdUpscaleRunner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  return runHdUpscaleRoute(request);
}
