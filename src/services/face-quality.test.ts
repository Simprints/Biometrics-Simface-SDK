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
    expect(result.sharpnessScore).toBe(0);
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

  it('flags when the head is tilted (roll)', () => {
    const result = evaluateFaceQuality({
      detections: [
        createDetection({
          keypoints: [
            { x: 0.42, y: 0.38 },  // right eye higher
            { x: 0.58, y: 0.46 },  // left eye lower
            { x: 0.5, y: 0.53 },
          ],
        }),
      ],
      width: 1000,
      height: 1000,
    });

    // eyeTiltRatio = (0.38 - 0.46) / 0.16 = -0.5 → tilt-right
    expect(result.feedback).toBe('tilt-right');
    expect(result.passesQualityChecks).toBe(false);
  });

  it('flags when looking up (chin raised, high pitch ratio)', () => {
    const result = evaluateFaceQuality({
      detections: [
        createDetection({
          keypoints: [
            { x: 0.42, y: 0.42 },
            { x: 0.58, y: 0.42 },
            { x: 0.5, y: 0.58 },  // nose far below eyes in 2D → looking up
          ],
        }),
      ],
      width: 1000,
      height: 1000,
    });

    // pitchRatio = (0.58 - 0.42) / 0.16 = 1.0 → look-down (corrective)
    expect(result.feedback).toBe('look-down');
    expect(result.passesQualityChecks).toBe(false);
  });

  it('flags when looking down (chin tucked, low pitch ratio)', () => {
    const result = evaluateFaceQuality({
      detections: [
        createDetection({
          keypoints: [
            { x: 0.42, y: 0.42 },
            { x: 0.58, y: 0.42 },
            { x: 0.5, y: 0.445 },  // nose barely below eyes in 2D → looking down
          ],
        }),
      ],
      width: 1000,
      height: 1000,
    });

    // pitchRatio = (0.445 - 0.42) / 0.16 = 0.15625 → look-up (corrective)
    expect(result.feedback).toBe('look-up');
    expect(result.passesQualityChecks).toBe(false);
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

  it('defaults to sharpnessScore 1 when not provided (image mode)', () => {
    const result = evaluateFaceQuality({
      detections: [createDetection()],
      width: 1000,
      height: 1000,
    });

    expect(result.sharpnessScore).toBe(1);
    expect(result.passesQualityChecks).toBe(true);
  });

  it('includes sharpnessScore in captureScore when provided', () => {
    const withSharpness = evaluateFaceQuality({
      detections: [createDetection()],
      width: 1000,
      height: 1000,
      sharpnessScore: 1.0,
    });
    const withLowSharpness = evaluateFaceQuality({
      detections: [createDetection()],
      width: 1000,
      height: 1000,
      sharpnessScore: 0.3,
    });

    expect(withSharpness.captureScore).toBeGreaterThan(withLowSharpness.captureScore);
  });

  it('rejects frame as too-blurry when sharpnessScore is below threshold', () => {
    const result = evaluateFaceQuality({
      detections: [createDetection()],
      width: 1000,
      height: 1000,
      sharpnessScore: 0.05,
    });

    expect(result.feedback).toBe('too-blurry');
    expect(result.passesQualityChecks).toBe(false);
    expect(result.isCentered).toBe(true);
    expect(result.message).toContain('blurry');
  });

  it('accepts frame when sharpnessScore is at the minimum threshold', () => {
    const result = evaluateFaceQuality({
      detections: [createDetection()],
      width: 1000,
      height: 1000,
      sharpnessScore: 0.15,
    });

    expect(result.feedback).toBe('good');
    expect(result.passesQualityChecks).toBe(true);
  });

  it('reports sharpnessScore on the result object', () => {
    const result = evaluateFaceQuality({
      detections: [createDetection()],
      width: 1000,
      height: 1000,
      sharpnessScore: 0.72,
    });

    expect(result.sharpnessScore).toBe(0.72);
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
