/**
 * Image sharpness estimation via Laplacian variance.
 *
 * A sharp image has strong edges (high second-derivative response) and
 * therefore a high variance in the Laplacian-filtered output. A blurry
 * image has weak edges and low variance.
 */

export interface SharpnessRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Reference Laplacian variance used to normalise the raw variance into a
 * 0–1 score.  Values at or above this are mapped to 1.0.  This was tuned
 * empirically against 640×480 webcam frames; it may need adjustment for
 * significantly different resolutions.
 */
const REFERENCE_VARIANCE = 800;
const GRAY_BUFFER_GROWTH_FACTOR = 1.5;

/** Minimum sharpness score (0–1) below which a frame is considered too blurry. */
export const MIN_SHARPNESS_SCORE = 0.15;

const grayBuffersByCanvas = new WeakMap<HTMLCanvasElement, Float32Array>();

/**
 * Compute a normalised sharpness score (0–1) for the given video frame.
 *
 * The score is the Laplacian variance of the face region, clamped and
 * mapped to [0, 1] using {@link REFERENCE_VARIANCE} as the ceiling.
 *
 * @param video   The video element to sample from.
 * @param region  The face bounding box in pixel coordinates.
 * @param canvas  An optional reusable offscreen canvas (avoids allocation per call).
 */
export function computeSharpnessScore(
  video: HTMLVideoElement,
  region: SharpnessRegion,
  canvas?: HTMLCanvasElement,
): number {
  const target = canvas ?? document.createElement('canvas');
  target.width = region.width;
  target.height = region.height;

  const ctx = target.getContext('2d');
  if (!ctx) return 0;

  ctx.drawImage(
    video,
    region.x, region.y, region.width, region.height,
    0, 0, region.width, region.height,
  );

  const imageData = ctx.getImageData(0, 0, region.width, region.height);
  const grayBuffer = canvas ? getReusableGrayBuffer(canvas, region.width * region.height) : undefined;
  const variance = Math.max(laplacianVariance(imageData, grayBuffer), 0);
  return Math.min(Math.max(variance / REFERENCE_VARIANCE, 0), 1);
}

/**
 * Compute the Laplacian variance of an ImageData buffer.
 *
 * 1. Convert RGBA → luminance using BT.601 luma weights.
 * 2. Convolve with the 3×3 Laplacian kernel: [[0,1,0],[1,-4,1],[0,1,0]]
 * 3. Return the variance of the filtered values.
 *
 * Exported for direct unit-testing with synthetic ImageData.
 */
export function laplacianVariance(imageData: ImageData, grayBuffer?: Float32Array): number {
  const { data, width, height } = imageData;

  // --- Step 1: grayscale luminance ---
  const pixelCount = width * height;
  const gray = grayBuffer && grayBuffer.length >= pixelCount
    ? grayBuffer
    : new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    // ITU-R BT.601 luma weights
    gray[i] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  }

  // --- Step 2: Laplacian convolution (skip 1-pixel border) ---
  const innerPixels = (width - 2) * (height - 2);
  if (innerPixels <= 0) return 0;

  let sum = 0;
  let sumSq = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        gray[idx - width] +          // top
        gray[idx - 1] +              // left
        -4 * gray[idx] +             // center
        gray[idx + 1] +              // right
        gray[idx + width];           // bottom
      sum += lap;
      sumSq += lap * lap;
    }
  }

  // variance = E[X²] - E[X]²
  const mean = sum / innerPixels;
  return Math.max(sumSq / innerPixels - mean * mean, 0);
}

function getReusableGrayBuffer(canvas: HTMLCanvasElement, pixelCount: number): Float32Array {
  const existing = grayBuffersByCanvas.get(canvas);
  if (existing && existing.length >= pixelCount) {
    return existing;
  }

  const nextSize = existing
    ? Math.max(pixelCount, Math.ceil(existing.length * GRAY_BUFFER_GROWTH_FACTOR))
    : pixelCount;
  const next = new Float32Array(nextSize);
  grayBuffersByCanvas.set(canvas, next);
  return next;
}
