/**
 * Central capture-configuration constants.
 *
 * Every quality threshold, score weight, and timing value used during face
 * capture lives here so there is a single source of truth to review and tune.
 */

// ---------------------------------------------------------------------------
// Face size (area ratio relative to the full image)
// ---------------------------------------------------------------------------
/** Minimum face area ratio — "too far" feedback when smaller. */
export const MIN_FACE_AREA_RATIO = 0.1;
/** Maximum face area ratio — "too close" feedback when larger. */
export const MAX_FACE_AREA_RATIO = 0.42;
/** Optimal face area ratio used for scoring distance. */
export const IDEAL_FACE_AREA_RATIO = 0.24;

// ---------------------------------------------------------------------------
// Face centering
// ---------------------------------------------------------------------------
/** Horizontal centering tolerance (±fraction of image width from centre). */
export const CENTER_TOLERANCE_X = 0.14;
/** Vertical centering tolerance (±fraction of image height from centre). */
export const CENTER_TOLERANCE_Y = 0.18;

// ---------------------------------------------------------------------------
// Head pose
// ---------------------------------------------------------------------------
/** Yaw: max horizontal nose-offset / interocular distance. */
export const MAX_NOSE_OFFSET_RATIO = 0.12;
/** Roll: max eye vertical difference / interocular distance. */
export const MAX_EYE_TILT_RATIO = 0.2;
/** Pitch ceiling: higher values mean chin tucked / looking down (BlazeFace). */
export const MAX_PITCH_RATIO = 0.95;
/** Pitch floor: lower values mean chin raised / looking up (BlazeFace). */
export const MIN_PITCH_RATIO = 0.2;

// ---------------------------------------------------------------------------
// Sharpness / blur
// ---------------------------------------------------------------------------
/**
 * Laplacian-variance ceiling for normalising the raw variance into a 0–1
 * score.  Values at or above this map to 1.0.  Tuned for 640×480 webcam
 * frames; may need adjustment for significantly different resolutions.
 */
export const REFERENCE_VARIANCE = 800;
/** Minimum normalised sharpness score (0–1) — "too blurry" when below. */
export const MIN_SHARPNESS_SCORE = 0.15;
/**
 * Fallback sharpness score used when sharpness data is unavailable
 * (e.g. single-image mode with no live video feed).
 */
export const DEFAULT_SHARPNESS_SCORE = 1;

// ---------------------------------------------------------------------------
// Detection confidence
// ---------------------------------------------------------------------------
/** Minimum MediaPipe detection confidence to consider a face detected. */
export const MIN_CONFIDENCE = 0.7;

// ---------------------------------------------------------------------------
// Auto-capture timing
// ---------------------------------------------------------------------------
/** Milliseconds between face-quality analysis frames during auto-capture. */
export const AUTO_CAPTURE_ANALYSIS_INTERVAL_MS = 180;
/** Total countdown duration (ms) once auto-capture conditions are met. */
export const AUTO_CAPTURE_COUNTDOWN_MS = 5000;

// ---------------------------------------------------------------------------
// Capture score weights (must sum to 1.0)
// ---------------------------------------------------------------------------
export const SCORE_WEIGHT_CONFIDENCE = 0.40;
export const SCORE_WEIGHT_CENTER = 0.25;
export const SCORE_WEIGHT_SIZE = 0.10;
export const SCORE_WEIGHT_SHARPNESS = 0.25;
