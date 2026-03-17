/**
 * SimFace SDK — Drop-in facial recognition for web-based KYC.
 *
 * Usage:
 *   import { enroll, verify } from '@simprints/simface-sdk';
 *
 *   const config = { projectId: '...', apiKey: '...' };
 *
 *   // Enroll a new user
 *   const result = await enroll(config, 'user-123');
 *
 *   // Verify an existing user
 *   const result = await verify(config, 'user-123');
 */

import type {
  SimFaceCaptureElement,
  SimFaceWorkflowOptions,
  SimFaceConfig,
  EnrollResult,
  VerifyResult,
} from './types/index.js';
import { SimFaceAPIClient } from './services/api-client.js';
import { captureFromCamera } from './services/camera.js';

// Re-export types and component for consumers
export type {
  CapturePreference,
  SimFaceCaptureElement,
  SimFaceWorkflowOptions,
  SimFaceConfig,
  EnrollResult,
  VerifyResult,
  FaceQualityResult,
  ValidateResult,
} from './types/index.js';
export { SimFaceAPIClient } from './services/api-client.js';
export { assessFaceQuality, assessFaceQualityForVideo } from './services/face-detection.js';
export { captureFromCamera, blobToImage, blobToDataURL } from './services/camera.js';
export { SimFaceCapture } from './components/simface-capture.js';

/**
 * Enroll a user with facial recognition.
 *
 * Opens the camera, captures a face image, validates quality,
 * and sends it to the backend for enrollment.
 *
 * If the user is already enrolled, returns { alreadyEnrolled: true }.
 * The optional workflow options control cross-presentation capture behavior.
 * Passing capture UI options switches the helper into embedded mode.
 */
export async function enroll(
  config: SimFaceConfig,
  clientId: string,
  workflowOptions?: SimFaceWorkflowOptions,
  captureElement?: SimFaceCaptureElement,
): Promise<EnrollResult> {
  const client = new SimFaceAPIClient(config);

  // Validate API key first
  await client.validateAPIKey();

  // Capture face image
  const blob = await captureWithQualityCheck(workflowOptions, captureElement);
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
 * The optional workflow options control cross-presentation capture behavior.
 * Passing capture UI options switches the helper into embedded mode.
 */
export async function verify(
  config: SimFaceConfig,
  clientId: string,
  workflowOptions?: SimFaceWorkflowOptions,
  captureElement?: SimFaceCaptureElement,
): Promise<VerifyResult> {
  const client = new SimFaceAPIClient(config);

  // Validate API key first
  await client.validateAPIKey();

  // Capture face image
  const blob = await captureWithQualityCheck(workflowOptions, captureElement);
  if (!blob) {
    return { match: false, score: 0, threshold: 0, message: 'Capture cancelled by user' };
  }

  return client.verify(clientId, blob);
}

/**
 * Capture a face image with the camera flow's built-in quality validation.
 */
async function captureWithQualityCheck(
  workflowOptions?: SimFaceWorkflowOptions,
  captureElement?: SimFaceCaptureElement,
): Promise<Blob | null> {
  return captureFromCamera(workflowOptions, captureElement);
}
