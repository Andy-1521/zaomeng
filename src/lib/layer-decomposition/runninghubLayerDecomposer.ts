import {
  createTask,
  getTaskOutputs,
  waitForTaskComplete,
} from '@/lib/runningHub';
import { resolveLayerPlanningHints } from './planning';
import type {
  LayerDecompositionResult,
  LayerItem,
  LayerDecompositionSlots,
  LayerPlanningHints,
} from './types';

function createIndexedLayer(
  name: string,
  kind: LayerItem['kind'],
  imageUrl: string,
  zIndex: number,
  sourceIndex: number
): LayerItem {
  return { name, kind, imageUrl, zIndex, sourceIndex };
}

function mapRunningHubOutputsToSlots(imageUrls: string[], hints: LayerPlanningHints): LayerDecompositionSlots {
  const total = imageUrls.length;

  if (total === 0) {
    return {};
  }

  const slots: LayerDecompositionSlots = {};

  if (typeof hints.backgroundSourceIndex === 'number' && imageUrls[hints.backgroundSourceIndex]) {
    slots.background = createIndexedLayer('Background', 'background', imageUrls[hints.backgroundSourceIndex], 0, hints.backgroundSourceIndex);
  }

  const othersIndexes = hints.othersSourceIndexes || [];
  if (othersIndexes.length > 0) {
    const firstOthersIndex = othersIndexes[0];
    if (imageUrls[firstOthersIndex]) {
      slots.others = createIndexedLayer('Others', 'others', imageUrls[firstOthersIndex], firstOthersIndex, firstOthersIndex);
    }
  }

  return slots;
}

function buildLayers(imageUrls: string[], hints: LayerPlanningHints): LayerItem[] {
  const layerHints = new Map<number, Pick<LayerItem, 'name' | 'kind'>>();

  if (typeof hints.backgroundSourceIndex === 'number' && imageUrls[hints.backgroundSourceIndex]) {
    layerHints.set(hints.backgroundSourceIndex, { name: 'Background', kind: 'background' });
  }

  return imageUrls.map((imageUrl, sourceIndex) => {
    const hintedLayer = layerHints.get(sourceIndex);
    if (hintedLayer) {
      return createIndexedLayer(hintedLayer.name, hintedLayer.kind, imageUrl, sourceIndex, sourceIndex);
    }

    return createIndexedLayer(`Layer ${sourceIndex + 1}`, 'others', imageUrl, sourceIndex, sourceIndex);
  });
}

export async function decomposeLayersWithRunningHub(imageUrl: string): Promise<LayerDecompositionResult> {
  const taskId = await createTask(imageUrl);
  await waitForTaskComplete(taskId, 9);
  const outputs = await getTaskOutputs(taskId);

  const pngOutputs = outputs.filter((output) => output.fileType === 'png' && output.fileUrl);
  if (pngOutputs.length === 0) {
    throw new Error('RunningHub 分层任务未返回可用 PNG 图层');
  }

  const imageUrls = pngOutputs.map((output) => output.fileUrl);
  const hints = resolveLayerPlanningHints(imageUrls.length);
  const slots = mapRunningHubOutputsToSlots(imageUrls, hints);
  const layers = buildLayers(imageUrls, hints);

  return {
    source: 'runninghub',
    layers,
    slots,
    taskId,
  };
}
