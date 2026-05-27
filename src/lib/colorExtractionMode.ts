export type ColorExtractionMode = 'full';

type ColorExtractionModePayload = {
  extractionMode?: unknown;
  actualExtractionMode?: unknown;
};

export type ColorExtractionModeMeta = {
  requestedMode: ColorExtractionMode;
  actualMode: ColorExtractionMode;
};

function normalizeColorExtractionMode(value: unknown): ColorExtractionMode | null {
  if (value === 'full') {
    return 'full';
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

  return {
    requestedMode,
    actualMode,
  };
}
