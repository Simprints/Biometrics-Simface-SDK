import type { FaceFeedbackCode, FaceQualityResult } from '../types/index.js';
import { MIN_SHARPNESS_SCORE } from './sharpness.js';

export interface FaceBoundingBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface FaceKeypoint {
  x: number;
  y: number;
}

export interface FaceDetectionSnapshot {
  boundingBox?: FaceBoundingBox;
  confidence: number;
  keypoints: FaceKeypoint[];
}

interface FaceQualityInput {
  width: number;
  height: number;
  detections: FaceDetectionSnapshot[];
  /** Normalised sharpness score (0–1) for the face region. Omit when unavailable (e.g. image mode). */
  sharpnessScore?: number;
  /** Lazily compute sharpness only after framing and pose checks pass. */
  resolveSharpnessScore?: () => number;
}

const MIN_FACE_AREA_RATIO = 0.1;
const MAX_FACE_AREA_RATIO = 0.42;
const IDEAL_FACE_AREA_RATIO = 0.24;
const CENTER_TOLERANCE_X = 0.14;
const CENTER_TOLERANCE_Y = 0.18;

/** Yaw: max horizontal nose offset / interocular distance. */
const MAX_NOSE_OFFSET_RATIO = 0.12;
/** Roll: max eye vertical difference / interocular distance. */
const MAX_EYE_TILT_RATIO = 0.2;
/** Pitch ceiling: live BlazeFace signal shows higher ratios when the chin is tucked / looking down. */
const MAX_PITCH_RATIO = 0.95;
/** Pitch floor: live BlazeFace signal shows lower ratios when the chin is raised / looking up. */
const MIN_PITCH_RATIO = 0.2;
/** Image-mode sharpness is unavailable, so do not penalise captures for a missing live-video metric. */
const DEFAULT_SHARPNESS_SCORE = 1;

const KEYPOINT_RIGHT_EYE = 0;
const KEYPOINT_LEFT_EYE = 1;
const KEYPOINT_NOSE = 2;

export function evaluateFaceQuality(input: FaceQualityInput): FaceQualityResult {
  const { detections, width, height, sharpnessScore, resolveSharpnessScore } = input;

  if (detections.length === 0) {
    return createQualityResult({
      hasFace: false,
      faceCount: 0,
      confidence: 0,
      captureScore: 0,
      sharpnessScore: 0,
      isCentered: false,
      passesQualityChecks: false,
      feedback: 'no-face',
      message: 'No face detected. Center your face in the oval and look at the camera.',
    });
  }

  if (detections.length > 1) {
    return createQualityResult({
      hasFace: true,
      faceCount: detections.length,
      confidence: detections[0]?.confidence ?? 0,
      captureScore: 0,
      sharpnessScore: 0,
      isCentered: false,
      passesQualityChecks: false,
      feedback: 'multiple-faces',
      message: 'Multiple faces detected. Make sure only one person is in view.',
    });
  }

  const detection = detections[0];
  const bbox = detection.boundingBox;

  if (!bbox) {
    return createQualityResult({
      hasFace: true,
      faceCount: 1,
      confidence: detection.confidence,
      captureScore: 0,
      sharpnessScore: 0,
      isCentered: false,
      passesQualityChecks: false,
      feedback: 'face-unclear',
      message: 'Face detected, but the frame is unclear. Hold still and try again.',
    });
  }

  const faceAreaRatio = (bbox.width * bbox.height) / (width * height);
  if (faceAreaRatio < MIN_FACE_AREA_RATIO) {
    return createFrameAdjustmentResult(detection.confidence, 'too-far', 'Move closer to the camera.');
  }

  if (faceAreaRatio > MAX_FACE_AREA_RATIO) {
    return createFrameAdjustmentResult(detection.confidence, 'too-close', 'Move slightly farther away.');
  }

  const faceCenterX = (bbox.originX + bbox.width / 2) / width;
  const faceCenterY = (bbox.originY + bbox.height / 2) / height;

  if (faceCenterX < 0.5 - CENTER_TOLERANCE_X) {
    return createFrameAdjustmentResult(detection.confidence, 'move-left', 'Move your face a little to the left.');
  }

  if (faceCenterX > 0.5 + CENTER_TOLERANCE_X) {
    return createFrameAdjustmentResult(detection.confidence, 'move-right', 'Move your face a little to the right.');
  }

  if (faceCenterY < 0.5 - CENTER_TOLERANCE_Y) {
    return createFrameAdjustmentResult(detection.confidence, 'move-down', 'Move your face slightly down.');
  }

  if (faceCenterY > 0.5 + CENTER_TOLERANCE_Y) {
    return createFrameAdjustmentResult(detection.confidence, 'move-up', 'Move your face slightly up.');
  }

  const poseFeedback = detectPoseFeedback(detection.keypoints);
  if (poseFeedback) {
    return createFrameAdjustmentResult(detection.confidence, poseFeedback.feedback, poseFeedback.message);
  }

  const resolvedSharpness = sharpnessScore ?? resolveSharpnessScore?.() ?? DEFAULT_SHARPNESS_SCORE;

  if (resolvedSharpness < MIN_SHARPNESS_SCORE) {
    return createQualityResult({
      hasFace: true,
      faceCount: 1,
      confidence: detection.confidence,
      captureScore: calculateCaptureScore(detection.confidence, faceCenterX, faceCenterY, faceAreaRatio, resolvedSharpness),
      sharpnessScore: resolvedSharpness,
      isCentered: true,
      passesQualityChecks: false,
      feedback: 'too-blurry',
      message: 'Hold still so the image is not blurry.',
    });
  }

  return createQualityResult({
    hasFace: true,
    faceCount: 1,
    confidence: detection.confidence,
    captureScore: calculateCaptureScore(detection.confidence, faceCenterX, faceCenterY, faceAreaRatio, resolvedSharpness),
    sharpnessScore: resolvedSharpness,
    isCentered: true,
    passesQualityChecks: true,
    feedback: 'good',
    message: 'Hold still. Capturing automatically...',
  });
}

function detectPoseFeedback(keypoints: FaceKeypoint[]): { feedback: FaceFeedbackCode; message: string } | null {
  const rightEye = keypoints[KEYPOINT_RIGHT_EYE];
  const leftEye = keypoints[KEYPOINT_LEFT_EYE];
  const nose = keypoints[KEYPOINT_NOSE];

  if (!rightEye || !leftEye || !nose) {
    return null;
  }

  const eyeDistanceX = Math.abs(leftEye.x - rightEye.x);
  if (eyeDistanceX === 0) {
    return null;
  }

  // Yaw: horizontal nose offset relative to eye midpoint
  const eyeMidpointX = (rightEye.x + leftEye.x) / 2;
  const noseOffsetRatio = (nose.x - eyeMidpointX) / eyeDistanceX;
  if (noseOffsetRatio <= -MAX_NOSE_OFFSET_RATIO) {
    return {
      feedback: 'turn-left',
      message: 'Turn slightly left so your face points at the camera.',
    };
  }
  if (noseOffsetRatio >= MAX_NOSE_OFFSET_RATIO) {
    return {
      feedback: 'turn-right',
      message: 'Turn slightly right so your face points at the camera.',
    };
  }

  // Roll: head tilt detected via eye vertical difference
  const eyeTiltRatio = (rightEye.y - leftEye.y) / eyeDistanceX;
  if (eyeTiltRatio >= MAX_EYE_TILT_RATIO) {
    return {
      feedback: 'tilt-left',
      message: 'Straighten your head — it is tilting to the right.',
    };
  }
  if (eyeTiltRatio <= -MAX_EYE_TILT_RATIO) {
    return {
      feedback: 'tilt-right',
      message: 'Straighten your head — it is tilting to the left.',
    };
  }

  // Pitch: nose vertical offset relative to eye midpoint
  const eyeMidpointY = (rightEye.y + leftEye.y) / 2;
  const pitchRatio = (nose.y - eyeMidpointY) / eyeDistanceX;
  if (pitchRatio >= MAX_PITCH_RATIO) {
    return {
      feedback: 'look-up',
      message: 'Raise your chin slightly so your face points at the camera.',
    };
  }
  if (pitchRatio <= MIN_PITCH_RATIO) {
    return {
      feedback: 'look-down',
      message: 'Lower your chin slightly so your face points at the camera.',
    };
  }

  return null;
}

function createFrameAdjustmentResult(
  confidence: number,
  feedback: FaceFeedbackCode,
  message: string,
): FaceQualityResult {
  return createQualityResult({
    hasFace: true,
    faceCount: 1,
    confidence,
    captureScore: 0,
    sharpnessScore: 0,
    isCentered: false,
    passesQualityChecks: false,
    feedback,
    message,
  });
}

function createQualityResult(result: FaceQualityResult): FaceQualityResult {
  return result;
}

function calculateCaptureScore(
  confidence: number,
  faceCenterX: number,
  faceCenterY: number,
  faceAreaRatio: number,
  sharpnessScore: number,
) {
  const xPenalty = Math.abs(faceCenterX - 0.5) / CENTER_TOLERANCE_X;
  const yPenalty = Math.abs(faceCenterY - 0.5) / CENTER_TOLERANCE_Y;
  const centerScore = 1 - Math.min((xPenalty + yPenalty) / 2, 1);

  const maxAreaDistance = Math.max(
    Math.abs(IDEAL_FACE_AREA_RATIO - MIN_FACE_AREA_RATIO),
    Math.abs(MAX_FACE_AREA_RATIO - IDEAL_FACE_AREA_RATIO),
  );
  const sizeScore = 1 - Math.min(Math.abs(faceAreaRatio - IDEAL_FACE_AREA_RATIO) / maxAreaDistance, 1);

  return Number(
    (confidence * 0.40 + centerScore * 0.25 + sizeScore * 0.10 + sharpnessScore * 0.25).toFixed(4),
  );
}
