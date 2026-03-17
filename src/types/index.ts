/** Configuration for the SimFace SDK. */
export interface SimFaceConfig {
  /** Unique identifier for the project. */
  projectId: string;
  /** API key for authentication. */
  apiKey: string;
  /** Optional base URL of the SimFace API backend. Defaults to the hosted SimFace backend. */
  apiUrl?: string;
}

/** Result of an enrollment operation. */
export interface EnrollResult {
  success: boolean;
  clientId: string;
  message?: string;
  /** True if the user was already enrolled and verification is needed instead. */
  alreadyEnrolled?: boolean;
}

/** Result of a verification operation. */
export interface VerifyResult {
  match: boolean;
  score: number;
  threshold: number;
  message?: string;
  /** True if the user was not found and enrollment is needed instead. */
  notEnrolled?: boolean;
}

export type CapturePreference = 'auto-preferred' | 'manual-only';

/** Cross-presentation capture behavior for the top-level SDK helpers. */
export interface SimFaceWorkflowOptions {
  /** Whether auto capture should be preferred when supported, or disabled entirely. */
  capturePreference?: CapturePreference;
  /** Whether the flow may fall back to a media picker if camera capture is unavailable. */
  allowMediaPickerFallback?: boolean;
}

/** Public surface of the `simface-capture` element used by the top-level SDK helpers. */
export interface SimFaceCaptureElement extends HTMLElement {
  embedded: boolean;
  active: boolean;
  label: string;
  idleFeedbackLabel: string;
  confirmLabel: string;
  captureLabel: string;
  retakeLabel: string;
  retryLabel: string;
  capturePreference: CapturePreference;
  allowMediaPickerFallback: boolean;
  startCapture: () => Promise<void>;
}

/** Result of API key validation. */
export interface ValidateResult {
  valid: boolean;
  projectId: string;
  name: string;
}

/** Face quality assessment result from MediaPipe. */
export type FaceFeedbackCode =
  | 'no-face'
  | 'multiple-faces'
  | 'too-far'
  | 'too-close'
  | 'move-left'
  | 'move-right'
  | 'move-up'
  | 'move-down'
  | 'turn-left'
  | 'turn-right'
  | 'tilt-left'
  | 'tilt-right'
  | 'look-up'
  | 'look-down'
  | 'face-unclear'
  | 'too-blurry'
  | 'good';

export interface FaceQualityResult {
  hasFace: boolean;
  faceCount: number;
  confidence: number;
  captureScore: number;
  sharpnessScore: number;
  isCentered: boolean;
  passesQualityChecks: boolean;
  feedback: FaceFeedbackCode;
  message: string;
}

/** Events emitted by the SimFace capture component. */
export interface SimFaceCaptureEvents {
  /** Fired when a face image is captured and quality-checked. */
  'simface-captured': CustomEvent<{ imageBlob: Blob }>;
  /** Fired when the user cancels the capture flow. */
  'simface-cancelled': CustomEvent<void>;
  /** Fired when an error occurs during capture. */
  'simface-error': CustomEvent<{ error: string }>;
}

/** API error response from the backend. */
export interface APIError {
  error: string;
}
