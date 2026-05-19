export type SmartEditAspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
export type SmartEditAspectRatioOption = 'auto' | SmartEditAspectRatio;
export type SmartEditResolution = '1k' | '2k' | '4k';

export const DEFAULT_SMART_EDIT_SIZE: SmartEditAspectRatio = '1:1';
export const DEFAULT_SMART_EDIT_SIZE_OPTION: SmartEditAspectRatioOption = 'auto';

export const SMART_EDIT_SIZE_OPTIONS: Array<{
  value: SmartEditAspectRatioOption;
  label: string;
  description: string;
}> = [
  { value: 'auto', label: '自动', description: '按原图匹配最近比例' },
  { value: '1:1', label: '1:1', description: '正方形' },
  { value: '2:3', label: '2:3', description: '竖版海报' },
  { value: '3:2', label: '3:2', description: '横版照片' },
  { value: '3:4', label: '3:4', description: '经典竖版' },
  { value: '4:3', label: '4:3', description: '经典横版' },
  { value: '4:5', label: '4:5', description: '竖版社媒' },
  { value: '5:4', label: '5:4', description: '横版社媒' },
  { value: '9:16', label: '9:16', description: '手机竖屏' },
  { value: '16:9', label: '16:9', description: '宽屏横版' },
  { value: '21:9', label: '21:9', description: '超宽横版' },
];

const SMART_EDIT_ASPECT_RATIO_VALUES: Record<SmartEditAspectRatio, number> = {
  '1:1': 1,
  '2:3': 2 / 3,
  '3:2': 3 / 2,
  '3:4': 3 / 4,
  '4:3': 4 / 3,
  '4:5': 4 / 5,
  '5:4': 5 / 4,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '21:9': 21 / 9,
};

const LEGACY_SIZE_TO_ASPECT_RATIO: Record<string, SmartEditAspectRatio> = {
  '1024x1024': '1:1',
  '1024x1536': '2:3',
  '1536x1024': '3:2',
  '1024x1792': '2:3',
  '1792x1024': '3:2',
};

export function isSmartEditAspectRatio(value: string | undefined | null): value is SmartEditAspectRatio {
  return value === '1:1'
    || value === '2:3'
    || value === '3:2'
    || value === '3:4'
    || value === '4:3'
    || value === '4:5'
    || value === '5:4'
    || value === '9:16'
    || value === '16:9'
    || value === '21:9';
}

export function isSmartEditAspectRatioOption(value: string | undefined | null): value is SmartEditAspectRatioOption {
  return value === 'auto' || isSmartEditAspectRatio(value);
}

export function isSmartEditResolution(value: string | undefined | null): value is SmartEditResolution {
  return value === '1k' || value === '2k' || value === '4k';
}

export function normalizeLegacySmartEditSize(value: string | undefined | null): SmartEditAspectRatio | null {
  if (!value) return null;
  return LEGACY_SIZE_TO_ASPECT_RATIO[value] || null;
}

export function resolveSmartEditAspectRatio(
  requestedRatio: string | undefined | null,
  sourceSize?: { width?: number | null; height?: number | null },
): SmartEditAspectRatio {
  if (isSmartEditAspectRatio(requestedRatio)) {
    return requestedRatio;
  }

  const normalizedLegacySize = normalizeLegacySmartEditSize(requestedRatio);
  if (normalizedLegacySize) {
    return normalizedLegacySize;
  }

  const width = sourceSize?.width ?? 0;
  const height = sourceSize?.height ?? 0;
  if (!(width > 0) || !(height > 0)) {
    return DEFAULT_SMART_EDIT_SIZE;
  }

  const sourceAspectRatio = width / height;
  let bestMatch: SmartEditAspectRatio = DEFAULT_SMART_EDIT_SIZE;
  let smallestDifference = Number.POSITIVE_INFINITY;

  (Object.keys(SMART_EDIT_ASPECT_RATIO_VALUES) as SmartEditAspectRatio[]).forEach((ratio) => {
    const difference = Math.abs(Math.log(sourceAspectRatio / SMART_EDIT_ASPECT_RATIO_VALUES[ratio]));
    if (difference < smallestDifference) {
      smallestDifference = difference;
      bestMatch = ratio;
    }
  });

  return bestMatch;
}

function getSmartEditLongEdge(resolution: SmartEditResolution) {
  if (resolution === '4k') return 4096;
  if (resolution === '1k') return 1024;
  return 2048;
}

export function getSmartEditOutputSize(
  requestedRatio: string | undefined | null,
  resolution: SmartEditResolution,
  sourceSize?: { width?: number | null; height?: number | null },
) {
  const resolvedAspectRatio = resolveSmartEditAspectRatio(requestedRatio, sourceSize);
  const longEdge = getSmartEditLongEdge(resolution);
  const [widthRatio, heightRatio] = resolvedAspectRatio.split(':').map(Number);

  if (!(widthRatio > 0) || !(heightRatio > 0)) {
    return {
      width: longEdge,
      height: longEdge,
      resolvedAspectRatio,
    };
  }

  if (widthRatio >= heightRatio) {
    return {
      width: longEdge,
      height: Math.max(1, Math.round((longEdge * heightRatio) / widthRatio)),
      resolvedAspectRatio,
    };
  }

  return {
    width: Math.max(1, Math.round((longEdge * widthRatio) / heightRatio)),
    height: longEdge,
    resolvedAspectRatio,
  };
}

export function formatSmartEditSizeLabel(size: string | undefined | null) {
  if (!size) return '';
  if (size === 'auto') return '自动';
  if (isSmartEditAspectRatio(size)) return size;
  const normalizedLegacySize = normalizeLegacySmartEditSize(size);
  if (normalizedLegacySize) return normalizedLegacySize;
  return size;
}
