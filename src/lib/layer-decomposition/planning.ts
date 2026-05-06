import type { LayerPlanningHints, TextLayerCandidate } from './types';

export function resolveLayerPlanningHints(
  layerCount: number,
  candidates: TextLayerCandidate[] = []
): LayerPlanningHints {
  if (layerCount <= 0) {
    return {};
  }

  const backgroundSourceIndex = layerCount - 1;
  const validTextCandidate = [...candidates]
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .find((candidate) =>
      typeof candidate.sourceIndex === 'number'
      && candidate.sourceIndex >= 0
      && candidate.sourceIndex < backgroundSourceIndex
    );

  const textSourceIndex = validTextCandidate?.sourceIndex;

  const remainingForegroundIndexes = Array.from({ length: Math.max(0, layerCount - 1) }, (_, index) => index)
    .filter((index) => index !== textSourceIndex);

  return {
    backgroundSourceIndex,
    textSourceIndex,
    mainElementSourceIndex: remainingForegroundIndexes[0],
    secondaryElementSourceIndex: remainingForegroundIndexes[1],
    othersSourceIndexes: remainingForegroundIndexes.slice(2),
  };
}
