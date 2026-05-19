import { mergeImagesToPsd, type PsdLayerConfig } from '@/lib/psdMerge';
import type { LayerDecompositionResult, LayerItem } from '@/lib/layer-decomposition';

const layerOrder: Record<LayerItem['kind'], number> = {
  background: 0,
  others: 10,
};

export function mapLayersToPsdConfig(layers: LayerItem[]): PsdLayerConfig[] {
  return [...layers]
    .sort((a, b) => {
      const orderDiff = layerOrder[a.kind] - layerOrder[b.kind];
      if (orderDiff !== 0) return orderDiff;
      return a.zIndex - b.zIndex;
    })
    .map((layer) => ({
      url: layer.imageUrl,
      name: layer.name,
      isBackground: layer.kind === 'background',
    }));
}

export async function generatePsdFromLayers(layers: LayerItem[]): Promise<Buffer> {
  return mergeImagesToPsd(mapLayersToPsdConfig(layers));
}

export async function generatePsdFromDecomposition(result: LayerDecompositionResult): Promise<Buffer> {
  return generatePsdFromLayers(result.layers);
}
