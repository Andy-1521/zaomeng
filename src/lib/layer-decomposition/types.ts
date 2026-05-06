export type LayerKind = 'background' | 'text' | 'main-element' | 'secondary-element' | 'others';

export interface LayerItem {
  name: string;
  kind: LayerKind;
  imageUrl: string;
  zIndex: number;
  sourceIndex?: number;
}

export interface LayerDecompositionSlots {
  background?: LayerItem;
  text?: LayerItem;
  mainElement?: LayerItem;
  secondaryElement?: LayerItem;
  others?: LayerItem;
}

export interface LayerPlanningHints {
  backgroundSourceIndex?: number;
  textSourceIndex?: number;
  mainElementSourceIndex?: number;
  secondaryElementSourceIndex?: number;
  othersSourceIndexes?: number[];
}

export interface TextLayerCandidate {
  sourceIndex: number;
  confidence?: number;
  label?: string;
}

export interface LayerDecompositionResult {
  source: 'runninghub';
  layers: LayerItem[];
  slots: LayerDecompositionSlots;
  taskId?: string;
}
