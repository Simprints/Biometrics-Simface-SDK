import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeSharpnessScore, laplacianVariance, MIN_SHARPNESS_SCORE } from './sharpness.js';

/**
 * Helper to create synthetic ImageData with a flat RGBA pixel array.
 * Each pixel is set to the given grayscale value (R=G=B=value, A=255).
 */
function createUniformImageData(width: number, height: number, value: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

/**
 * Create ImageData with a sharp vertical edge running down the middle.
 * Left half is `low`, right half is `high`.
 */
function createEdgeImageData(width: number, height: number, low: number, high: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  const midX = Math.floor(width / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const value = x < midX ? low : high;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

/**
 * Create ImageData with a checkerboard pattern (high-frequency edges).
 */
function createCheckerboardImageData(
  width: number,
  height: number,
  low: number,
  high: number,
  cellSize: number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const cellX = Math.floor(x / cellSize);
      const cellY = Math.floor(y / cellSize);
      const value = (cellX + cellY) % 2 === 0 ? low : high;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('laplacianVariance', () => {
  it('returns 0 for a completely uniform image', () => {
    const imageData = createUniformImageData(50, 50, 128);
    expect(laplacianVariance(imageData)).toBe(0);
  });

  it('returns 0 for a uniform black image', () => {
    const imageData = createUniformImageData(50, 50, 0);
    expect(laplacianVariance(imageData)).toBe(0);
  });

  it('returns 0 for a uniform white image', () => {
    const imageData = createUniformImageData(50, 50, 255);
    expect(laplacianVariance(imageData)).toBe(0);
  });

  it('returns a positive value for an image with a sharp edge', () => {
    const imageData = createEdgeImageData(50, 50, 0, 255);
    expect(laplacianVariance(imageData)).toBeGreaterThan(0);
  });

  it('returns a higher value for a sharp edge than a subtle edge', () => {
    const sharp = createEdgeImageData(50, 50, 0, 255);
    const subtle = createEdgeImageData(50, 50, 100, 155);
    expect(laplacianVariance(sharp)).toBeGreaterThan(laplacianVariance(subtle));
  });

  it('returns a high value for a checkerboard pattern (many edges)', () => {
    const checkerboard = createCheckerboardImageData(50, 50, 0, 255, 2);
    const singleEdge = createEdgeImageData(50, 50, 0, 255);
    expect(laplacianVariance(checkerboard)).toBeGreaterThan(laplacianVariance(singleEdge));
  });

  it('returns 0 for an image that is too small to have inner pixels', () => {
    const imageData = createUniformImageData(2, 2, 128);
    expect(laplacianVariance(imageData)).toBe(0);
  });

  it('handles a 3×3 image (minimum size with 1 inner pixel)', () => {
    const imageData = createEdgeImageData(3, 3, 0, 255);
    // Should not throw and should return a finite number
    const result = laplacianVariance(imageData);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe('MIN_SHARPNESS_SCORE', () => {
  it('is a positive number between 0 and 1', () => {
    expect(MIN_SHARPNESS_SCORE).toBeGreaterThan(0);
    expect(MIN_SHARPNESS_SCORE).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// computeSharpnessScore
// ---------------------------------------------------------------------------

const REFERENCE_VARIANCE = 800;

function createMockVideo(width = 640, height = 480): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { value: width, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: height, configurable: true });
  return video;
}

describe('computeSharpnessScore', () => {
  let mockCtx: { drawImage: ReturnType<typeof vi.fn>; getImageData: ReturnType<typeof vi.fn> };
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(),
    };
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    getContextSpy.mockRestore();
  });

  it('returns 0 when canvas context is unavailable', () => {
    getContextSpy.mockReturnValue(null);
    const video = createMockVideo();
    const region = { x: 0, y: 0, width: 50, height: 50 };
    expect(computeSharpnessScore(video, region)).toBe(0);
  });

  it('returns a normalised score for a video frame', () => {
    const region = { x: 0, y: 0, width: 50, height: 50 };
    mockCtx.getImageData.mockReturnValue(createEdgeImageData(50, 50, 0, 255));

    const score = computeSharpnessScore(createMockVideo(), region);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('clamps score to 1 when variance exceeds REFERENCE_VARIANCE', () => {
    const region = { x: 0, y: 0, width: 50, height: 50 };
    // Checkerboard with cell size 1 produces very high Laplacian variance
    mockCtx.getImageData.mockReturnValue(createCheckerboardImageData(50, 50, 0, 255, 1));

    // Verify the underlying variance actually exceeds REFERENCE_VARIANCE
    const varianceCheck = laplacianVariance(createCheckerboardImageData(50, 50, 0, 255, 1));
    expect(varianceCheck).toBeGreaterThan(REFERENCE_VARIANCE);

    const score = computeSharpnessScore(createMockVideo(), region);
    expect(score).toBe(1);
  });

  it('returns 0 for uniform (blurry) regions', () => {
    const region = { x: 0, y: 0, width: 50, height: 50 };
    mockCtx.getImageData.mockReturnValue(createUniformImageData(50, 50, 128));

    const score = computeSharpnessScore(createMockVideo(), region);
    expect(score).toBe(0);
  });

  it('reuses provided canvas instead of creating a new one', () => {
    const region = { x: 0, y: 0, width: 60, height: 40 };
    mockCtx.getImageData.mockReturnValue(createEdgeImageData(60, 40, 0, 255));

    const canvas = document.createElement('canvas');
    computeSharpnessScore(createMockVideo(), region, canvas);

    expect(canvas.width).toBe(region.width);
    expect(canvas.height).toBe(region.height);
  });

  it('gray buffer reuse grows when region size increases', () => {
    const canvas = document.createElement('canvas');

    // First call – small region
    const smallRegion = { x: 0, y: 0, width: 10, height: 10 };
    mockCtx.getImageData.mockReturnValue(createEdgeImageData(10, 10, 0, 255));
    expect(() => computeSharpnessScore(createMockVideo(), smallRegion, canvas)).not.toThrow();

    // Second call – larger region forces buffer growth
    const largeRegion = { x: 0, y: 0, width: 50, height: 50 };
    mockCtx.getImageData.mockReturnValue(createEdgeImageData(50, 50, 0, 255));
    expect(() => computeSharpnessScore(createMockVideo(), largeRegion, canvas)).not.toThrow();
  });
});
