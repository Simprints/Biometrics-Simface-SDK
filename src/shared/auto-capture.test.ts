import {describe, expect, it} from 'vitest';
import type {FaceQualityResult} from '../types';
import {AUTO_CAPTURE_COUNTDOWN_MS, autoCaptureCompleteMessage, autoCaptureCountdownMessage,} from './auto-capture.js';

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

describe('autoCaptureCountdownMessage', () => {
  it('returns idle message when countdownStartedAt is null', () => {
    const result = autoCaptureCountdownMessage(1000, null, createQualityResult());
    expect(result).toBe(
      'Center your face in the oval. We will capture automatically when framing looks good.',
    );
  });

  it('returns "Hold steady..." with correct seconds when quality passes', () => {
    const startedAt = 0;
    const timestamp = 2500;
    const result = autoCaptureCountdownMessage(timestamp, startedAt, createQualityResult());
    // remaining = 5000 - 2500 = 2500ms → ceil(2.5) = 3s
    expect(result).toBe('Hold steady. Capturing the best frame in 3s.');
  });

  it('uses qualityResult.message prefix when quality does not pass', () => {
    const startedAt = 0;
    const timestamp = 2500;
    const qr = createQualityResult({
      passesQualityChecks: false,
      message: 'Move closer.',
    });
    const result = autoCaptureCountdownMessage(timestamp, startedAt, qr);
    expect(result).toBe('Move closer. Best frame selection finishes in 3s.');
  });

  it('shows 0s when remaining time is exactly 0', () => {
    const startedAt = 0;
    const result = autoCaptureCountdownMessage(AUTO_CAPTURE_COUNTDOWN_MS, startedAt, createQualityResult());
    expect(result).toBe('Hold steady. Capturing the best frame in 0s.');
  });

  it('shows 0s when timestamp exceeds countdown duration', () => {
    const startedAt = 0;
    const timestamp = AUTO_CAPTURE_COUNTDOWN_MS + 5000;
    const qr = createQualityResult({ passesQualityChecks: false, message: 'Too far.' });
    const result = autoCaptureCountdownMessage(timestamp, startedAt, qr);
    expect(result).toBe('Too far. Best frame selection finishes in 0s.');
  });

  it('rounds up remaining seconds mid-countdown', () => {
    const startedAt = 1000;
    const timestamp = 3500;
    // remaining = 5000 - 2500 = 2500ms → ceil(2.5) = 3s
    const result = autoCaptureCountdownMessage(timestamp, startedAt, createQualityResult());
    expect(result).toBe('Hold steady. Capturing the best frame in 3s.');
  });
});

describe('autoCaptureCompleteMessage', () => {
  it('returns generic message when bestQualityResult is null', () => {
    expect(autoCaptureCompleteMessage(null)).toBe(
      'Capture complete. Review and confirm this photo.',
    );
  });

  it('returns "Best frame captured..." when captureScore > 0', () => {
    const qr = createQualityResult({ captureScore: 0.85 });
    expect(autoCaptureCompleteMessage(qr)).toBe(
      'Best frame captured. Review and confirm this photo.',
    );
  });

  it('returns generic message when captureScore is 0', () => {
    const qr = createQualityResult({ captureScore: 0 });
    expect(autoCaptureCompleteMessage(qr)).toBe(
      'Capture complete. Review and confirm this photo.',
    );
  });
});
