import type { SmartEditResolution } from '@/lib/smartEditSize';

export type { SmartEditResolution } from '@/lib/smartEditSize';

export type PaidActionId = 'color-extraction' | 'generate-psd' | 'generate-clown' | 'ai-generate' | 'outpaint-upsampling' | 'hd-upscale' | 'smart-edit';

type StandardResolution = SmartEditResolution;

const COLOR_EXTRACTION_POINTS = 30;
const GENERATE_PSD_POINTS = 20;
const GENERATE_CLOWN_POINTS = 10;
const AI_GENERATE_POINTS: Record<StandardResolution, number> = {
  '1k': 20,
  '2k': 20,
  '4k': 40,
};
const OUTPAINT_UPSAMPLING_POINTS = 30;
const HD_UPSCALE_POINTS = 5;
const SMART_EDIT_POINTS: Record<StandardResolution, number> = {
  '1k': 30,
  '2k': 30,
  '4k': 60,
};

export function getColorExtractionPoints() {
  return COLOR_EXTRACTION_POINTS;
}

export function getGeneratePsdPoints() {
  return GENERATE_PSD_POINTS;
}

export function getGenerateClownPoints() {
  return GENERATE_CLOWN_POINTS;
}

export function getAiGeneratePoints(resolution: SmartEditResolution) {
  return AI_GENERATE_POINTS[resolution] ?? AI_GENERATE_POINTS['2k'];
}

export function getOutpaintUpsamplingPoints() {
  return OUTPAINT_UPSAMPLING_POINTS;
}

export function getHdUpscalePoints() {
  return HD_UPSCALE_POINTS;
}

export function getSmartEditPoints(resolution: SmartEditResolution) {
  return SMART_EDIT_POINTS[resolution] ?? SMART_EDIT_POINTS['2k'];
}

export function formatPointsLabel(points: number) {
  return `${points}积分`;
}
