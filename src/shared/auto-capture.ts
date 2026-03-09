import type { FaceQualityResult } from '../types/index.js';

export const AUTO_CAPTURE_ANALYSIS_INTERVAL_MS = 180;
export const AUTO_CAPTURE_COUNTDOWN_MS = 5000;

export const CAPTURE_GUIDE_PATH = 'M 50 17 C 60 17 68 19.5 74 25 C 79 29.5 81.5 36.5 81.5 46.5 V 54.5 C 81.5 63.5 78.5 71 71.5 76.5 C 65 81.5 57.5 84 50 84 C 42.5 84 35 81.5 28.5 76.5 C 21.5 71 18.5 63.5 18.5 54.5 V 46.5 C 18.5 36.5 21 29.5 26 25 C 32 19.5 40 17 50 17 Z';
export const CAPTURE_GUIDE_MASK_PATH = `M 0 0 H 100 V 100 H 0 Z ${CAPTURE_GUIDE_PATH}`;

export function autoCaptureCountdownMessage(
  timestamp: number,
  countdownStartedAt: number | null,
  qualityResult: FaceQualityResult,
) {
  if (countdownStartedAt === null) {
    return 'Center your face in the oval. We will capture automatically when framing looks good.';
  }

  const remainingMs = Math.max(AUTO_CAPTURE_COUNTDOWN_MS - (timestamp - countdownStartedAt), 0);
  const remainingSeconds = Math.max(Math.ceil(remainingMs / 1000), 0);
  if (qualityResult.passesQualityChecks) {
    return `Hold steady. Capturing the best frame in ${remainingSeconds}s.`;
  }

  return `${qualityResult.message} Best frame selection finishes in ${remainingSeconds}s.`;
}

export function autoCaptureCompleteMessage(bestQualityResult: FaceQualityResult | null) {
  const score = bestQualityResult?.captureScore;
  if (typeof score === 'number' && score > 0) {
    return 'Best frame captured. Review and confirm this photo.';
  }

  return 'Capture complete. Review and confirm this photo.';
}
