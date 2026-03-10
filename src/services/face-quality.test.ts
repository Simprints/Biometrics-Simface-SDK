import { describe, expect, it } from 'vitest';
import { evaluateFaceQuality } from './face-quality.js';

describe('evaluateFaceQuality', () => {
  it('flags when no face is detected', () => {
    const result = evaluateFaceQuality({
      detections: [],
      width: 1000,
      height: 1000,
    });

    expect(result.feedback).toBe('no-face');
    expect(result.passesQualityChecks).toBe(false);
  });

  it('flags when the face is too far away', () => {
    const result = evaluateFaceQuality({
      detections: [createDetection({ width: 120, height: 120 })],
      width: 1000,
      height: 1000,
    });

    expect(result.feedback).toBe('too-far');
    expect(result.message).toContain('Move closer');
  });

  it('flags when the face is off-center horizontally', () => {
    const result = evaluateFaceQuality({
      detections: [createDetection({ originX: 80, originY: 250, width: 360, height: 420 })],
      width: 1000,
      height: 1000,
    });

    expect(result.feedback).toBe('move-left');
    expect(result.isCentered).toBe(false);
  });

  it('flags when the user is turned away from the camera', () => {
    const result = evaluateFaceQuality({
      detections: [
        createDetection({
          originX: 280,
          originY: 220,
          width: 320,
          height: 420,
          keypoints: [
            { x: 0.38, y: 0.42 },
            { x: 0.58, y: 0.42 },
            { x: 0.34, y: 0.52 },
          ],
        }),
      ],
      width: 1000,
      height: 1000,
    });

    expect(result.feedback).toBe('turn-left');
    expect(result.message).toContain('Turn slightly left');
  });

  it('passes when the face is centered, sized correctly, and facing forward', () => {
    const result = evaluateFaceQuality({
      detections: [createDetection({ originX: 300, originY: 180, width: 320, height: 420 })],
      width: 1000,
      height: 1000,
    });

    expect(result.feedback).toBe('good');
    expect(result.passesQualityChecks).toBe(true);
    expect(result.isCentered).toBe(true);
  });
});

function createDetection(
  overrides: Partial<{
    originX: number;
    originY: number;
    width: number;
    height: number;
    confidence: number;
    keypoints: Array<{ x: number; y: number }>;
  }> = {},
) {
  const {
    originX = 300,
    originY = 180,
    width = 320,
    height = 420,
    confidence = 0.95,
    keypoints = [
      { x: 0.42, y: 0.42 },
      { x: 0.58, y: 0.42 },
      { x: 0.5, y: 0.53 },
    ],
  } = overrides;

  return {
    boundingBox: {
      originX,
      originY,
      width,
      height,
    },
    confidence,
    keypoints,
  };
}
