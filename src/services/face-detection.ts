import type { Detection, FaceDetector as MediaPipeFaceDetector } from '@mediapipe/tasks-vision';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { evaluateFaceQuality } from './face-quality.js';
import { computeSharpnessScore } from './sharpness.js';
import type { FaceQualityResult } from '../types/index.js';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

// Minimum confidence to consider a face detected
const MIN_CONFIDENCE = 0.7;
let visionInstance: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
let imageDetectorInstance: Promise<MediaPipeFaceDetector> | null = null;
let videoDetectorInstance: Promise<MediaPipeFaceDetector> | null = null;

function getVision(): ReturnType<typeof FilesetResolver.forVisionTasks> {
  visionInstance ??= FilesetResolver.forVisionTasks(WASM_CDN);
  return visionInstance;
}

function getImageDetector(): Promise<MediaPipeFaceDetector> {
  imageDetectorInstance ??= createDetector('IMAGE');
  return imageDetectorInstance;
}

export function getVideoDetector(): Promise<MediaPipeFaceDetector> {
  videoDetectorInstance ??= createDetector('VIDEO');
  return videoDetectorInstance;
}

async function createDetector(runningMode: 'IMAGE' | 'VIDEO'): Promise<MediaPipeFaceDetector> {
  const vision = await getVision();

  return FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode,
    minDetectionConfidence: MIN_CONFIDENCE,
  });
}

/**
 * Assess face quality from a captured image.
 * Checks: face present, single face, face centered, sufficient size.
 */
export async function assessFaceQuality(imageElement: HTMLImageElement): Promise<FaceQualityResult> {
  const detector = await getImageDetector();
  const result = detector.detect(imageElement);

  return evaluateFaceQuality({
    detections: mapDetections(result.detections),
    width: imageElement.naturalWidth,
    height: imageElement.naturalHeight,
  });
}

// Reusable offscreen canvas for sharpness computation (avoids allocation per frame)
let sharpnessCanvas: HTMLCanvasElement | null = null;

export async function assessFaceQualityForVideo(
  videoElement: HTMLVideoElement,
  timestamp: number,
): Promise<FaceQualityResult> {
  const detector = await getVideoDetector();
  const result = detector.detectForVideo(videoElement, timestamp);
  const detections = mapDetections(result.detections);

  return evaluateFaceQuality({
    detections,
    width: videoElement.videoWidth,
    height: videoElement.videoHeight,
    resolveSharpnessScore: detections.length === 1 && detections[0].boundingBox
      ? () => {
          const bbox = detections[0].boundingBox!;
          sharpnessCanvas ??= document.createElement('canvas');
          return computeSharpnessScore(
            videoElement,
            {
              x: bbox.originX,
              y: bbox.originY,
              width: bbox.width,
              height: bbox.height,
            },
            sharpnessCanvas,
          );
        }
      : undefined,
  });
}

function mapDetections(detections: Detection[]) {
  return detections.map((detection) => ({
    boundingBox: detection.boundingBox
      ? {
          originX: detection.boundingBox.originX,
          originY: detection.boundingBox.originY,
          width: detection.boundingBox.width,
          height: detection.boundingBox.height,
        }
      : undefined,
    confidence: detection.categories[0]?.score ?? 0,
    keypoints: detection.keypoints.map((keypoint) => ({
      x: keypoint.x,
      y: keypoint.y,
    })),
  }));
}
