import {
  createTask,
  getTaskOutputs,
  waitForTaskComplete,
} from '@/lib/runningHub';
import { resolveLayerPlanningHints } from './planning';
import { detectTextLayerCandidates } from './textLayerPlanner';
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

  if (typeof hints.textSourceIndex === 'number' && imageUrls[hints.textSourceIndex]) {
    slots.text = createIndexedLayer('Text', 'text', imageUrls[hints.textSourceIndex], 40, hints.textSourceIndex);
  }

  if (typeof hints.mainElementSourceIndex === 'number' && imageUrls[hints.mainElementSourceIndex]) {
    slots.mainElement = createIndexedLayer('Main Element', 'main-element', imageUrls[hints.mainElementSourceIndex], 30, hints.mainElementSourceIndex);
  }

  if (typeof hints.secondaryElementSourceIndex === 'number' && imageUrls[hints.secondaryElementSourceIndex]) {
    slots.secondaryElement = createIndexedLayer('Secondary Element', 'secondary-element', imageUrls[hints.secondaryElementSourceIndex], 20, hints.secondaryElementSourceIndex);
  }

  const othersIndexes = hints.othersSourceIndexes || [];
  if (othersIndexes.length > 0) {
    const lastOthersIndex = othersIndexes[othersIndexes.length - 1];
    if (imageUrls[lastOthersIndex]) {
      slots.others = createIndexedLayer('Others', 'others', imageUrls[lastOthersIndex], 10, lastOthersIndex);
    }
  }

  return slots;
}

function slotsToLayers(slots: LayerDecompositionSlots): LayerItem[] {
  return [
    slots.background,
    slots.text,
    slots.mainElement,
    slots.secondaryElement,
    slots.others,
  ].filter((item): item is LayerItem => Boolean(item));
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
  const textCandidates = await detectTextLayerCandidates({
    imageUrl,
    layerImageUrls: imageUrls,
  });
  const hints = resolveLayerPlanningHints(imageUrls.length, textCandidates);
  const slots = mapRunningHubOutputsToSlots(imageUrls, hints);
  const layers = slotsToLayers(slots);

  return {
    source: 'runninghub',
    layers,
    slots,
    taskId,
  };
}
