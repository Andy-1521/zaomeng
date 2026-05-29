import { NextRequest } from 'next/server';
import { runBackgroundRemovalRoute } from '@/lib/backgroundRemovalRunner';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  return runBackgroundRemovalRoute(request);
}
