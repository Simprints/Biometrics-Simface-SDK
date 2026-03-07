import type { FaceQualityResult } from '../types/index.js';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

// Minimum confidence to consider a face detected
const MIN_CONFIDENCE = 0.7;

// Face must occupy at least this fraction of the image (centered check)
const MIN_FACE_AREA_RATIO = 0.08;
const MAX_FACE_AREA_RATIO = 0.85;

// Face center must be within this fraction of image center
const CENTER_TOLERANCE = 0.25;

let detectorInstance: FaceDetector | null = null;

async function getDetector(): Promise<FaceDetector> {
  if (detectorInstance) return detectorInstance;

  const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
  detectorInstance = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: 'IMAGE',
    minDetectionConfidence: MIN_CONFIDENCE,
  });

  return detectorInstance;
}

/**
 * Assess face quality from a captured image.
 * Checks: face present, single face, face centered, sufficient size.
 */
export async function assessFaceQuality(imageElement: HTMLImageElement): Promise<FaceQualityResult> {
  const detector = await getDetector();
  const result = detector.detect(imageElement);
  const detections = result.detections;

  if (detections.length === 0) {
    return {
      hasFace: false,
      faceCount: 0,
      confidence: 0,
      isCentered: false,
      message: 'No face detected. Please ensure your face is visible and well-lit.',
    };
  }

  if (detections.length > 1) {
    return {
      hasFace: true,
      faceCount: detections.length,
      confidence: detections[0].categories[0]?.score ?? 0,
      isCentered: false,
      message: 'Multiple faces detected. Please ensure only your face is in the frame.',
    };
  }

  const detection = detections[0];
  const bbox = detection.boundingBox;
  const confidence = detection.categories[0]?.score ?? 0;

  if (!bbox) {
    return {
      hasFace: true,
      faceCount: 1,
      confidence,
      isCentered: false,
      message: 'Face detected but could not determine position.',
    };
  }

  const imgW = imageElement.naturalWidth;
  const imgH = imageElement.naturalHeight;

  // Check face size relative to image
  const faceAreaRatio = (bbox.width * bbox.height) / (imgW * imgH);

  if (faceAreaRatio < MIN_FACE_AREA_RATIO) {
    return {
      hasFace: true,
      faceCount: 1,
      confidence,
      isCentered: false,
      message: 'Face is too far away. Please move closer to the camera.',
    };
  }

  if (faceAreaRatio > MAX_FACE_AREA_RATIO) {
    return {
      hasFace: true,
      faceCount: 1,
      confidence,
      isCentered: false,
      message: 'Face is too close. Please move further from the camera.',
    };
  }

  // Check face is centered
  const faceCenterX = (bbox.originX + bbox.width / 2) / imgW;
  const faceCenterY = (bbox.originY + bbox.height / 2) / imgH;
  const isCentered =
    Math.abs(faceCenterX - 0.5) < CENTER_TOLERANCE &&
    Math.abs(faceCenterY - 0.5) < CENTER_TOLERANCE;

  if (!isCentered) {
    return {
      hasFace: true,
      faceCount: 1,
      confidence,
      isCentered: false,
      message: 'Please center your face in the frame.',
    };
  }

  return {
    hasFace: true,
    faceCount: 1,
    confidence,
    isCentered: true,
    message: 'Face looks good!',
  };
}
