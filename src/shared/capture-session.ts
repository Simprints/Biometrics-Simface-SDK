import { assessFaceQuality, assessFaceQualityForVideo } from '../services/face-detection.js';
import type { FaceQualityResult } from '../types/index.js';
import {
  AUTO_CAPTURE_ANALYSIS_INTERVAL_MS,
  AUTO_CAPTURE_COUNTDOWN_MS,
  autoCaptureCompleteMessage,
  autoCaptureCountdownMessage,
} from './auto-capture.js';
import {
  blobToImage,
  createReusableFrameCapture,
  resumeVideoPlayback,
  waitForVideoReady,
} from './capture-runtime.js';

export type CaptureFeedbackTone = 'neutral' | 'success' | 'error' | 'manual';
export type LiveCaptureMode = 'auto' | 'manual';
export type CaptureFallbackReason = 'auto-capture-unavailable';

interface CameraCaptureStateBase {
  mode: LiveCaptureMode;
  feedbackMessage: string;
  feedbackTone: CaptureFeedbackTone;
  countdownProgress: number;
  qualityResult: FaceQualityResult | null;
  fallbackReason: CaptureFallbackReason | null;
}

export interface CameraCaptureStartingState extends CameraCaptureStateBase {
  phase: 'starting';
  previewBlob: null;
  errorMessage: '';
  canConfirm: false;
  canTakePhoto: false;
}

export interface CameraCaptureLiveState extends CameraCaptureStateBase {
  phase: 'live';
  previewBlob: null;
  errorMessage: '';
  canConfirm: false;
  canTakePhoto: true;
}

export interface CameraCapturePreviewState extends CameraCaptureStateBase {
  phase: 'preview';
  previewBlob: Blob;
  errorMessage: '';
  canConfirm: boolean;
  canTakePhoto: false;
}

export interface CameraCaptureErrorState extends CameraCaptureStateBase {
  phase: 'error';
  previewBlob: null;
  errorMessage: string;
  canConfirm: false;
  canTakePhoto: false;
}

export type CameraCaptureSessionState =
  | CameraCaptureStartingState
  | CameraCaptureLiveState
  | CameraCapturePreviewState
  | CameraCaptureErrorState;

export interface CameraCaptureSessionCopy {
  autoReadyMessage: string;
  manualReadyMessage: string;
  autoUnavailableMessage: string;
  retakeReadyMessage?: string;
}

export interface CameraCaptureSessionControllerOptions {
  videoElement: HTMLVideoElement;
  initialMode: LiveCaptureMode;
  copy: CameraCaptureSessionCopy;
  onStateChange: (state: CameraCaptureSessionState) => void;
  waitForReady?: (video: HTMLVideoElement) => Promise<void>;
  assessLiveQuality?: (
    videoElement: HTMLVideoElement,
    timestamp: number,
  ) => Promise<FaceQualityResult>;
  assessPreviewBlob?: (blob: Blob) => Promise<FaceQualityResult | null>;
}

export class CameraCaptureSessionController {
  private readonly videoElement: HTMLVideoElement;
  private readonly copy: CameraCaptureSessionCopy;
  private readonly onStateChange: (state: CameraCaptureSessionState) => void;
  private readonly waitForReady: (video: HTMLVideoElement) => Promise<void>;
  private readonly assessLiveQuality: (
    videoElement: HTMLVideoElement,
    timestamp: number,
  ) => Promise<FaceQualityResult>;
  private readonly assessPreviewBlob: (blob: Blob) => Promise<FaceQualityResult | null>;
  private readonly frameCapture = createReusableFrameCapture();

  private stopped = false;
  private mode: LiveCaptureMode;
  private state: CameraCaptureSessionState;
  private animationFrameId: number | null = null;
  private analysisTimerId: number | null = null;
  private analysisInFlight = false;
  private lastAnalysisTimestamp = 0;
  private countdownStartedAt: number | null = null;
  private bestCaptureScore = -1;
  private bestQualityResult: FaceQualityResult | null = null;

  constructor(options: CameraCaptureSessionControllerOptions) {
    this.videoElement = options.videoElement;
    this.copy = options.copy;
    this.onStateChange = options.onStateChange;
    this.waitForReady = options.waitForReady ?? ((video) => waitForVideoReady(video));
    this.assessLiveQuality = options.assessLiveQuality ?? assessFaceQualityForVideo;
    this.assessPreviewBlob = options.assessPreviewBlob ?? assessCapturedBlob;
    this.mode = options.initialMode;
    this.state = this.createStartingState();
    this.emit(this.state);
  }

  getState(): CameraCaptureSessionState {
    return this.state;
  }

  async start() {
    if (this.stopped) return;
    this.emit(this.createStartingState());
    await this.waitForReady(this.videoElement);
    if (this.stopped) return;
    this.emit(this.createLiveState({
      feedbackMessage: this.mode === 'auto'
        ? this.copy.autoReadyMessage
        : this.copy.manualReadyMessage,
      feedbackTone: this.mode === 'auto' ? 'neutral' : 'manual',
    }));

    if (this.mode === 'auto') {
      this.scheduleAutoAnalysis();
    }
  }

  async takePhotoNow() {
    if (this.stopped || this.state.phase !== 'live') {
      return;
    }

    const blob = await this.frameCapture.captureBlob(this.videoElement);
    if (this.stopped) return;
    const qualityResult = await this.assessPreviewBlob(blob);
    if (this.stopped) return;
    this.emit(this.createPreviewState(blob, qualityResult));
  }

  async retake() {
    if (this.stopped || this.state.phase !== 'preview') {
      return;
    }

    this.resetAutoState();
    resumeVideoPlayback(this.videoElement);
    this.emit(this.createLiveState({
      feedbackMessage: this.mode === 'auto'
        ? this.copy.autoReadyMessage
        : (this.copy.retakeReadyMessage ?? this.copy.manualReadyMessage),
      feedbackTone: this.mode === 'auto' ? 'neutral' : 'manual',
    }));

    if (this.mode === 'auto') {
      this.scheduleAutoAnalysis();
    }
  }

  confirm(): Blob {
    if (this.state.phase !== 'preview') {
      throw new Error('Failed to confirm the photo.');
    }

    return this.state.previewBlob;
  }

  stop() {
    this.stopped = true;
    this.cancelScheduledAnalysis();
  }

  private createStartingState(): CameraCaptureStartingState {
    return {
      phase: 'starting',
      mode: this.mode,
      feedbackMessage: '',
      feedbackTone: 'neutral',
      countdownProgress: 0,
      qualityResult: null,
      fallbackReason: null,
      previewBlob: null,
      errorMessage: '',
      canConfirm: false,
      canTakePhoto: false,
    };
  }

  private createLiveState(options: {
    feedbackMessage: string;
    feedbackTone: CaptureFeedbackTone;
    countdownProgress?: number;
    qualityResult?: FaceQualityResult | null;
    fallbackReason?: CaptureFallbackReason | null;
  }): CameraCaptureLiveState {
    return {
      phase: 'live',
      mode: this.mode,
      feedbackMessage: options.feedbackMessage,
      feedbackTone: options.feedbackTone,
      countdownProgress: options.countdownProgress ?? 0,
      qualityResult: options.qualityResult ?? null,
      fallbackReason: options.fallbackReason ?? null,
      previewBlob: null,
      errorMessage: '',
      canConfirm: false,
      canTakePhoto: true,
    };
  }

  private createPreviewState(
    blob: Blob,
    qualityResult: FaceQualityResult | null,
    options?: {
      feedbackMessage?: string;
      feedbackTone?: CaptureFeedbackTone;
    },
  ): CameraCapturePreviewState {
    return {
      phase: 'preview',
      mode: this.mode,
      feedbackMessage: options?.feedbackMessage
        ?? qualityResult?.message
        ?? 'Review the captured image before continuing.',
      feedbackTone: options?.feedbackTone
        ?? (qualityResult
          ? qualityResult.passesQualityChecks
            ? 'success'
            : 'error'
          : 'manual'),
      countdownProgress: qualityResult ? 1 : 0,
      qualityResult,
      fallbackReason: null,
      previewBlob: blob,
      errorMessage: '',
      canConfirm: qualityResult?.passesQualityChecks !== false,
      canTakePhoto: false,
    };
  }

  emitError(errorMessage: string) {
    if (this.stopped) return;
    this.cancelScheduledAnalysis();
    this.emit({
      phase: 'error',
      mode: this.mode,
      feedbackMessage: errorMessage,
      feedbackTone: 'error',
      countdownProgress: 0,
      qualityResult: null,
      fallbackReason: null,
      previewBlob: null,
      errorMessage,
      canConfirm: false,
      canTakePhoto: false,
    });
  }

  private emit(state: CameraCaptureSessionState) {
    if (this.stopped) return;
    this.state = state;
    this.onStateChange(state);
  }

  private scheduleAutoAnalysis() {
    if (this.stopped || this.mode !== 'auto' || this.state.phase !== 'live') {
      return;
    }

    const now = performance.now();
    const delay = Math.max(AUTO_CAPTURE_ANALYSIS_INTERVAL_MS - (now - this.lastAnalysisTimestamp), 0);
    this.cancelScheduledAnalysis();

    this.analysisTimerId = window.setTimeout(() => {
      this.analysisTimerId = null;
      this.animationFrameId = window.requestAnimationFrame((timestamp) => {
        void this.runAutoAnalysis(timestamp);
      });
    }, delay);
  }

  private async runAutoAnalysis(timestamp: number) {
    if (this.stopped) return;
    if (this.mode !== 'auto' || this.state.phase !== 'live' || this.analysisInFlight) {
      this.scheduleAutoAnalysis();
      return;
    }

    this.analysisInFlight = true;
    this.lastAnalysisTimestamp = timestamp;

    try {
      const qualityResult = await this.assessLiveQuality(this.videoElement, timestamp);
      if (this.stopped) return;

      if (qualityResult.passesQualityChecks) {
        if (this.countdownStartedAt === null) {
          this.countdownStartedAt = timestamp;
        }

        if (qualityResult.captureScore > this.bestCaptureScore) {
          this.frameCapture.storeBestFrame(this.videoElement);
          this.bestCaptureScore = qualityResult.captureScore;
          this.bestQualityResult = qualityResult;
        }
      }

      if (this.countdownStartedAt !== null) {
        const countdownProgress = Math.min(
          (timestamp - this.countdownStartedAt) / AUTO_CAPTURE_COUNTDOWN_MS,
          1,
        );

        if (countdownProgress >= 1) {
          await this.finishAutoCapture();
          return;
        }

        this.emit(this.createLiveState({
          feedbackMessage: autoCaptureCountdownMessage(
            timestamp,
            this.countdownStartedAt,
            qualityResult,
          ),
          feedbackTone: qualityResult.passesQualityChecks ? 'success' : 'neutral',
          countdownProgress,
          qualityResult,
        }));
      } else {
        this.emit(this.createLiveState({
          feedbackMessage: qualityResult.message,
          feedbackTone: qualityResult.passesQualityChecks ? 'success' : 'neutral',
          qualityResult,
        }));
      }
    } catch {
      this.switchToManual();
      return;
    } finally {
      this.analysisInFlight = false;
    }

    this.scheduleAutoAnalysis();
  }

  private async finishAutoCapture() {
    const blob = this.frameCapture.hasStoredBestFrame()
      ? await this.frameCapture.storedBestFrameToBlob()
      : await this.frameCapture.captureBlob(this.videoElement);
    if (this.stopped) return;
    const qualityResult = this.bestQualityResult ?? await this.assessPreviewBlob(blob);
    if (this.stopped) return;
    this.emit(this.createPreviewState(blob, qualityResult, {
      feedbackMessage: autoCaptureCompleteMessage(qualityResult),
      feedbackTone: qualityResult?.passesQualityChecks === false ? 'error' : 'success',
    }));
  }

  private switchToManual() {
    this.mode = 'manual';
    this.resetAutoState();
    this.emit(this.createLiveState({
      feedbackMessage: this.copy.autoUnavailableMessage,
      feedbackTone: 'manual',
      fallbackReason: 'auto-capture-unavailable',
    }));
  }

  private cancelScheduledAnalysis() {
    if (this.analysisTimerId !== null) {
      window.clearTimeout(this.analysisTimerId);
      this.analysisTimerId = null;
    }

    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private resetAutoState() {
    this.cancelScheduledAnalysis();
    this.countdownStartedAt = null;
    this.bestCaptureScore = -1;
    this.bestQualityResult = null;
    this.frameCapture.resetStoredBestFrame();
  }
}

async function assessCapturedBlob(blob: Blob): Promise<FaceQualityResult | null> {
  try {
    const image = await blobToImage(blob);
    return await assessFaceQuality(image);
  } catch {
    return null;
  }
}
