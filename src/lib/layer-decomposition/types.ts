export type LayerKind = 'background' | 'others';

export interface LayerItem {
  name: string;
  kind: LayerKind;
  imageUrl: string;
  zIndex: number;
  sourceIndex?: number;
}

export interface LayerDecompositionSlots {
  background?: LayerItem;
  others?: LayerItem;
}

export interface LayerPlanningHints {
  backgroundSourceIndex?: number;
  othersSourceIndexes?: number[];
}

export interface LayerDecompositionResult {
  source: 'runninghub';
  layers: LayerItem[];
  slots: LayerDecompositionSlots;
  taskId?: string;
}
