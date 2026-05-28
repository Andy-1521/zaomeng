import sharp from 'sharp';

type Center = {
  x: number;
  y: number;
  l: number;
  a: number;
  b: number;
  count: number;
};

const MAX_WORK_SIZE = 1024;
const MIN_CLUSTERS = 90;
const MAX_CLUSTERS = 620;
const ITERATIONS = 5;
const COMPACTNESS = 18;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function srgbToLinear(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function xyzPivot(value: number) {
  return value > 0.008856 ? Math.cbrt(value) : (7.787 * value) + (16 / 116);
}

function rgbToLab(r: number, g: number, b: number) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000;
  const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;

  const fx = xyzPivot(x);
  const fy = xyzPivot(y);
  const fz = xyzPivot(z);

  return {
    l: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function paletteColor(index: number) {
  const hue = (index * 137.508) % 360;
  const saturation = 72 + ((index * 17) % 22);
  const lightness = 48 + ((index * 29) % 18);
  return hslToRgb(hue, saturation / 100, lightness / 100);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs((2 * l) - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const m = l - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export async function generateClownSegmentationBuffer(imageBuffer: Buffer) {
  const sourceMetadata = await sharp(imageBuffer, { failOnError: false }).metadata();
  const sourceWidth = sourceMetadata.width || MAX_WORK_SIZE;
  const sourceHeight = sourceMetadata.height || MAX_WORK_SIZE;
  const resizeRatio = Math.min(1, MAX_WORK_SIZE / Math.max(sourceWidth, sourceHeight));
  const workWidth = Math.max(1, Math.round(sourceWidth * resizeRatio));
  const workHeight = Math.max(1, Math.round(sourceHeight * resizeRatio));

  const { data, info } = await sharp(imageBuffer, { failOnError: false })
    .rotate()
    .resize({
      width: workWidth,
      height: workHeight,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const pixelCount = width * height;
  const targetClusters = clamp(Math.round(pixelCount / 1800), MIN_CLUSTERS, MAX_CLUSTERS);
  const step = Math.max(8, Math.sqrt(pixelCount / targetClusters));
  const labsL = new Float32Array(pixelCount);
  const labsA = new Float32Array(pixelCount);
  const labsB = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 3;
    const lab = rgbToLab(data[offset], data[offset + 1], data[offset + 2]);
    labsL[i] = lab.l;
    labsA[i] = lab.a;
    labsB[i] = lab.b;
  }

  let centers: Center[] = [];
  for (let y = step / 2; y < height; y += step) {
    for (let x = step / 2; x < width; x += step) {
      const ix = clamp(Math.round(x), 0, width - 1);
      const iy = clamp(Math.round(y), 0, height - 1);
      const index = iy * width + ix;
      centers.push({
        x: ix,
        y: iy,
        l: labsL[index],
        a: labsA[index],
        b: labsB[index],
        count: 0,
      });
    }
  }

  const labels = new Int32Array(pixelCount);
  const distances = new Float32Array(pixelCount);
  const spatialScale = Math.pow(COMPACTNESS / step, 2);

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    labels.fill(-1);
    distances.fill(Number.POSITIVE_INFINITY);

    centers.forEach((center, centerIndex) => {
      const minX = clamp(Math.floor(center.x - step), 0, width - 1);
      const maxX = clamp(Math.ceil(center.x + step), 0, width - 1);
      const minY = clamp(Math.floor(center.y - step), 0, height - 1);
      const maxY = clamp(Math.ceil(center.y + step), 0, height - 1);

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const index = y * width + x;
          const dl = labsL[index] - center.l;
          const da = labsA[index] - center.a;
          const db = labsB[index] - center.b;
          const dx = x - center.x;
          const dy = y - center.y;
          const distance = (dl * dl) + (da * da) + (db * db) + spatialScale * ((dx * dx) + (dy * dy));

          if (distance < distances[index]) {
            distances[index] = distance;
            labels[index] = centerIndex;
          }
        }
      }
    });

    const nextCenters = centers.map(() => ({ x: 0, y: 0, l: 0, a: 0, b: 0, count: 0 }));
    for (let index = 0; index < pixelCount; index += 1) {
      const label = labels[index];
      if (label < 0) continue;
      const center = nextCenters[label];
      center.x += index % width;
      center.y += Math.floor(index / width);
      center.l += labsL[index];
      center.a += labsA[index];
      center.b += labsB[index];
      center.count += 1;
    }

    centers = centers.map((center, index) => {
      const next = nextCenters[index];
      if (!next.count) return center;
      return {
        x: next.x / next.count,
        y: next.y / next.count,
        l: next.l / next.count,
        a: next.a / next.count,
        b: next.b / next.count,
        count: next.count,
      };
    });
  }

  const sortedCenters = centers
    .map((center, index) => ({ center, index }))
    .sort((left, right) => left.center.y === right.center.y ? left.center.x - right.center.x : left.center.y - right.center.y);
  const paletteByLabel = new Map<number, [number, number, number]>();
  sortedCenters.forEach(({ index }, paletteIndex) => {
    paletteByLabel.set(index, paletteColor(paletteIndex));
  });

  const output = Buffer.alloc(pixelCount * 3);
  for (let index = 0; index < pixelCount; index += 1) {
    const label = labels[index] >= 0 ? labels[index] : 0;
    const color = paletteByLabel.get(label) || [255, 0, 0];
    const offset = index * 3;
    output[offset] = color[0];
    output[offset + 1] = color[1];
    output[offset + 2] = color[2];
  }

  return sharp(output, {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .resize({
      width: sourceWidth,
      height: sourceHeight,
      fit: 'fill',
      kernel: sharp.kernel.nearest,
    })
    .png({
      compressionLevel: 9,
      palette: false,
    })
    .toBuffer();
}
