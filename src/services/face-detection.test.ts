import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FaceQualityResult } from '../types/index.js';

const mediaPipeMocks = vi.hoisted(() => ({
  createFromOptions: vi.fn(),
  forVisionTasks: vi.fn(),
}));

const faceQualityMocks = vi.hoisted(() => ({
  evaluateFaceQuality: vi.fn(),
}));

const sharpnessMocks = vi.hoisted(() => ({
  computeSharpnessScore: vi.fn(),
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FaceDetector: {
    createFromOptions: mediaPipeMocks.createFromOptions,
  },
  FilesetResolver: {
    forVisionTasks: mediaPipeMocks.forVisionTasks,
  },
}));

vi.mock('./face-quality.js', () => faceQualityMocks);
vi.mock('./sharpness.js', () => sharpnessMocks);

import { assessFaceQualityForVideo } from './face-detection.js';

const MOCK_SHARPNESS_SCORE = 0.73;

describe('assessFaceQualityForVideo', () => {
  const detectForVideo = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mediaPipeMocks.forVisionTasks.mockResolvedValue({});
    mediaPipeMocks.createFromOptions.mockResolvedValue({ detectForVideo });
    sharpnessMocks.computeSharpnessScore.mockReturnValue(MOCK_SHARPNESS_SCORE);
  });

  it('defers sharpness computation until evaluateFaceQuality requests it', async () => {
    detectForVideo.mockReturnValue({
      detections: [createMediaPipeDetection()],
    });
    const videoElement = createVideoElement();
    faceQualityMocks.evaluateFaceQuality.mockImplementation(({ resolveSharpnessScore }) => {
      expect(resolveSharpnessScore).toBeTypeOf('function');
      expect(sharpnessMocks.computeSharpnessScore).not.toHaveBeenCalled();
      const resolvedSharpness = resolveSharpnessScore();
      expect(resolvedSharpness).toBe(MOCK_SHARPNESS_SCORE);
      expect(sharpnessMocks.computeSharpnessScore).toHaveBeenCalledTimes(1);
      expect(sharpnessMocks.computeSharpnessScore).toHaveBeenCalledWith(
        videoElement,
        {
          x: 120,
          y: 80,
          width: 320,
          height: 420,
        },
        expect.any(HTMLCanvasElement),
      );
      return createQualityResult({ sharpnessScore: resolvedSharpness });
    });

    const result = await assessFaceQualityForVideo(videoElement, 123);

    expect(result.feedback).toBe('good');
    expect(result.sharpnessScore).toBe(MOCK_SHARPNESS_SCORE);
  });

  it('skips sharpness computation when evaluateFaceQuality returns before using it', async () => {
    detectForVideo.mockReturnValue({
      detections: [createMediaPipeDetection({ width: 40, height: 40 })],
    });
    faceQualityMocks.evaluateFaceQuality.mockReturnValue(createQualityResult({
      feedback: 'too-far',
      passesQualityChecks: false,
    }));

    const result = await assessFaceQualityForVideo(createVideoElement(), 123);

    expect(result.feedback).toBe('too-far');
    expect(sharpnessMocks.computeSharpnessScore).not.toHaveBeenCalled();
    expect(faceQualityMocks.evaluateFaceQuality).toHaveBeenCalledWith(expect.objectContaining({
      resolveSharpnessScore: expect.any(Function),
    }));
  });
});

function createMediaPipeDetection(overrides: Partial<{ width: number; height: number }> = {}) {
  const { width = 320, height = 420 } = overrides;

  return {
    boundingBox: {
      originX: 120,
      originY: 80,
      width,
      height,
    },
    categories: [{ score: 0.95 }],
    keypoints: [
      { x: 0.42, y: 0.42 },
      { x: 0.58, y: 0.42 },
      { x: 0.5, y: 0.53 },
    ],
  };
}

function createVideoElement() {
  return {
    videoWidth: 640,
    videoHeight: 480,
  } as HTMLVideoElement;
}

function createQualityResult(overrides: Partial<FaceQualityResult> = {}): FaceQualityResult {
  return {
    hasFace: true,
    faceCount: 1,
    confidence: 0.95,
    captureScore: 0.9,
    sharpnessScore: 0.73,
    isCentered: true,
    passesQualityChecks: true,
    feedback: 'good',
    message: 'Hold still. Capturing automatically...',
    ...overrides,
  };
}
