export type ColorExtractionMode = 'full' | 'hollow';

type ColorExtractionModePayload = {
  extractionMode?: unknown;
  actualExtractionMode?: unknown;
  degraded?: unknown;
};

export type ColorExtractionModeMeta = {
  requestedMode: ColorExtractionMode;
  actualMode: ColorExtractionMode;
  degraded: boolean;
};

function normalizeColorExtractionMode(value: unknown): ColorExtractionMode | null {
  if (value === 'full' || value === 'hollow') {
    return value;
  }

  return null;
}

export function parseColorExtractionModeMeta(value: unknown): ColorExtractionModeMeta {
  let payload: ColorExtractionModePayload | null = null;

  if (typeof value === 'string') {
    try {
      payload = JSON.parse(value) as ColorExtractionModePayload;
    } catch {
      payload = null;
    }
  } else if (value && typeof value === 'object') {
    payload = value as ColorExtractionModePayload;
  }

  const requestedMode = normalizeColorExtractionMode(payload?.extractionMode) ?? 'full';
  const actualMode = normalizeColorExtractionMode(payload?.actualExtractionMode) ?? requestedMode;
  const degraded = payload?.degraded === true || (requestedMode === 'hollow' && actualMode === 'full');

  return {
    requestedMode,
    actualMode,
    degraded,
  };
}
