import type { LayerPlanningHints } from './types';

export function resolveLayerPlanningHints(layerCount: number): LayerPlanningHints {
  if (layerCount <= 0) {
    return {};
  }

  return {
    backgroundSourceIndex: layerCount - 1,
    othersSourceIndexes: Array.from({ length: Math.max(0, layerCount - 1) }, (_, index) => index),
  };
}
