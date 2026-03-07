/**
 * SimFace SDK — Drop-in facial recognition for web-based KYC.
 *
 * Usage:
 *   import { enroll, verify } from '@simprints/simface-sdk';
 *
 *   // Enroll a new user
 *   const result = await enroll({ apiUrl: '...', projectId: '...', apiKey: '...' }, 'user-123');
 *
 *   // Verify an existing user
 *   const result = await verify({ apiUrl: '...', projectId: '...', apiKey: '...' }, 'user-123');
 */

import type { SimFaceConfig, EnrollResult, VerifyResult } from './types/index.js';
import { SimFaceAPIClient } from './services/api-client.js';
import { captureFromCamera, blobToImage } from './services/camera.js';
import { assessFaceQuality } from './services/face-detection.js';

// Re-export types and component for consumers
export type { SimFaceConfig, EnrollResult, VerifyResult, FaceQualityResult, ValidateResult } from './types/index.js';
export { SimFaceAPIClient } from './services/api-client.js';
export { assessFaceQuality } from './services/face-detection.js';
export { captureFromCamera, blobToImage, blobToDataURL } from './services/camera.js';
export { SimFaceCapture } from './components/simface-capture.js';

/**
 * Enroll a user with facial recognition.
 *
 * Opens the camera, captures a face image, validates quality,
 * and sends it to the backend for enrollment.
 *
 * If the user is already enrolled, returns { alreadyEnrolled: true }.
 */
export async function enroll(config: SimFaceConfig, clientId: string): Promise<EnrollResult> {
  const client = new SimFaceAPIClient(config);

  // Validate API key first
  await client.validateAPIKey();

  // Capture face image
  const blob = await captureWithQualityCheck();
  if (!blob) {
    return { success: false, clientId, message: 'Capture cancelled by user' };
  }

  // Send to backend
  const result = await client.enroll(clientId, blob);

  // If already enrolled, auto-redirect to verify
  if (result.alreadyEnrolled) {
    return result;
  }

  return result;
}

/**
 * Verify a user with facial recognition.
 *
 * Opens the camera, captures a face image, validates quality,
 * and sends it to the backend for comparison against the enrolled image.
 *
 * If the user is not enrolled, returns { notEnrolled: true }.
 */
export async function verify(config: SimFaceConfig, clientId: string): Promise<VerifyResult> {
  const client = new SimFaceAPIClient(config);

  // Validate API key first
  await client.validateAPIKey();

  // Capture face image
  const blob = await captureWithQualityCheck();
  if (!blob) {
    return { match: false, score: 0, threshold: 0, message: 'Capture cancelled by user' };
  }

  return client.verify(clientId, blob);
}

/**
 * Capture a face image with quality validation.
 * Loops until a quality image is captured or the user cancels.
 */
async function captureWithQualityCheck(): Promise<Blob | null> {
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const blob = await captureFromCamera();
    if (!blob) return null;

    const img = await blobToImage(blob);
    const quality = await assessFaceQuality(img);

    if (quality.hasFace && quality.isCentered) {
      return blob;
    }

    // On last attempt, accept whatever we have if a face is present
    if (attempt === MAX_ATTEMPTS - 1 && quality.hasFace) {
      return blob;
    }
  }

  return null;
}
