import { LitElement, html, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { assessFaceQuality } from '../services/face-detection.js';
import {
  CAPTURE_GUIDE_MASK_PATH,
  CAPTURE_GUIDE_PATH,
} from '../shared/auto-capture.js';
import {
  buildCapturePlan,
  normalizeCaptureOptions,
  resolveCaptureCapabilities,
  type CapturePlanStep,
} from '../shared/capture-flow.js';
import {
  CameraCaptureSessionController,
  type CameraCaptureSessionState,
  type LiveCaptureMode,
} from '../shared/capture-session.js';
import {
  CameraAccessError,
  blobToImage,
  captureFromFileInput,
  openUserFacingCameraStream,
} from '../shared/capture-runtime.js';
import type { CapturePreference, FaceQualityResult } from '../types/index.js';

type CaptureState = 'idle' | 'starting' | 'live' | 'preview' | 'error';
type FeedbackTone = 'neutral' | 'success' | 'error' | 'manual';

/**
 * <simface-capture> — Web Component for capturing and quality-checking face images.
 *
 * Emits:
 *   - simface-captured: { imageBlob: Blob } when a quality-checked image is confirmed
 *   - simface-cancelled: when the user cancels
 *   - simface-error: { error: string } on errors
 */
@customElement('simface-capture')
export class SimFaceCapture extends LitElement {
  @property({ type: String }) label = 'Take a selfie';
  @property({ type: Boolean, reflect: true }) embedded = false;
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ type: String, attribute: 'confirm-label' }) confirmLabel = 'Use this capture';
  @property({ type: String, attribute: 'capture-preference' })
  capturePreference: CapturePreference = 'auto-preferred';
  @property({ type: Boolean, attribute: 'allow-media-picker-fallback' })
  allowMediaPickerFallback = true;

  @state() private captureState: CaptureState = 'idle';
  @state() private errorMessage = '';
  @state() private feedbackMessage = 'Start a capture to see camera guidance here.';
  @state() private feedbackTone: FeedbackTone = 'neutral';
  @state() private previewUrl = '';
  @state() private qualityResult: FaceQualityResult | null = null;
  @state() private canTakePhoto = true;
  @state() private captureMode: LiveCaptureMode = 'auto';

  @query('#embedded-video') private embeddedVideoElement?: HTMLVideoElement;

  private stream: MediaStream | null = null;
  private sessionController: CameraCaptureSessionController | null = null;
  private currentCaptureStep: CapturePlanStep | null = null;
  private capturedBlob: Blob | null = null;
  private pendingActiveSync = false;

  static styles = css`
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 400px;
      margin: 0 auto;
      text-align: center;
      color-scheme: light;
    }

    :host([embedded]) {
      max-width: none;
      margin: 0;
      text-align: left;
    }

    .container {
      padding: 16px;
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      background: #fafafa;
    }

    .capture-shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .capture-copy {
      margin: 0;
      color: #334155;
    }

    .stage {
      position: relative;
      overflow: hidden;
      width: min(100%, 420px);
      aspect-ratio: 3 / 4;
      border-radius: 22px;
      background:
        radial-gradient(circle at top, rgba(56, 189, 248, 0.16), transparent 30%),
        linear-gradient(180deg, #0f172a, #020617);
      box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.2);
      align-self: center;
    }

    .video,
    .preview-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }

    .preview-img {
      position: absolute;
      inset: 0;
      z-index: 2;
    }

    .guide-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 3;
    }

    .guide-overlay svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .guide-mask {
      fill: rgba(51, 65, 85, 0.75);
      fill-rule: evenodd;
    }

    .ring-outline {
      fill: none;
      stroke: rgba(255, 255, 255, 0.92);
      stroke-width: 2.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .ring-progress {
      fill: none;
      stroke: #22c55e;
      stroke-width: 2.8;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 100;
      stroke-dashoffset: calc(100 - var(--capture-progress, 0) * 100);
      transition: stroke-dashoffset 0.14s linear;
    }

    .btn-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 24px;
      margin: 8px 4px 0 0;
      border: none;
      border-radius: 999px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .btn-primary {
      background: #2563eb;
      color: white;
    }

    .btn-primary:hover {
      background: #1d4ed8;
    }

    .btn-primary:disabled {
      background: #93c5fd;
      cursor: not-allowed;
    }

    .btn-secondary {
      background: #e5e7eb;
      color: #374151;
    }

    .btn-secondary:hover {
      background: #d1d5db;
    }

    .btn-ghost {
      background: #e2e8f0;
      color: #0f172a;
    }

    .quality-msg {
      padding: 10px 14px;
      border-radius: 14px;
      margin: 8px 0 0;
      font-size: 14px;
      font-weight: 600;
    }

    .quality-good {
      background: #dcfce7;
      color: #166534;
    }

    .quality-bad {
      background: #fef2f2;
      color: #991b1b;
    }

    .quality-neutral {
      background: #e2e8f0;
      color: #0f172a;
    }

    .quality-manual {
      background: #e0f2fe;
      color: #0f172a;
    }

    .spinner {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 3px solid #e5e7eb;
      border-top: 3px solid #2563eb;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 12px auto;
    }

    .hidden {
      display: none;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopSession();
  }

  updated(changedProperties: Map<string, unknown>) {
    if (!changedProperties.has('active') || this.pendingActiveSync) {
      return;
    }

    this.pendingActiveSync = true;
    queueMicrotask(() => {
      this.pendingActiveSync = false;

      if (!this.isConnected) {
        return;
      }

      if (this.active) {
        if (this.captureState === 'idle') {
          void this.beginCapture();
        }
        return;
      }

      this.endCapture();
    });
  }

  render() {
    return html`
      <div class="container capture-shell">
        ${this.renderCaptureState()}
      </div>
    `;
  }

  public async startCapture() {
    this.active = true;
    await this.updateComplete;
    await this.beginCapture();
  }

  private renderCaptureState() {
    return html`
      <p class="capture-copy">${this.label}</p>

      ${this.captureState === 'idle'
        ? html`<p class="capture-copy">Waiting for the host page to start capture.</p>`
        : html`
            <div class="stage">
              <video
                id="embedded-video"
                class="video"
                autoplay
                muted
                playsinline
              ></video>
              <img
                class="preview-img ${this.captureState === 'preview' ? '' : 'hidden'}"
                src=${this.previewUrl}
                alt="Captured face preview"
              />
              <div
                class="guide-overlay ${this.captureState === 'live' || this.captureState === 'starting' ? '' : 'hidden'}"
              >
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <path class="guide-mask" d=${CAPTURE_GUIDE_MASK_PATH}></path>
                  <path class="ring-outline" d=${CAPTURE_GUIDE_PATH}></path>
                  <path class="ring-progress" d=${CAPTURE_GUIDE_PATH} pathLength="100"></path>
                </svg>
              </div>
            </div>
          `}

      <div class="quality-msg ${this.feedbackClass()}">
        ${this.captureState === 'starting' ? 'Requesting camera access...' : this.feedbackMessage}
      </div>

      <div class="btn-row">
        ${this.captureState === 'live'
          ? html`
              ${this.captureMode === 'manual'
                ? html`<button class="btn btn-secondary" data-simface-action="capture" ?disabled=${!this.canTakePhoto} @click=${this.handleManualCapture}>Take photo</button>`
                : ''}
              <button class="btn btn-ghost" data-simface-action="cancel" @click=${this.handleCancel}>Cancel</button>
            `
          : ''}
        ${this.captureState === 'preview'
          ? html`
              <button class="btn btn-secondary" data-simface-action="retake" @click=${this.handleRetake}>Retake</button>
              ${this.qualityResult?.passesQualityChecks === false
                ? ''
                : html`<button class="btn btn-primary" data-simface-action="confirm" @click=${this.handleConfirm}>${this.confirmLabel}</button>`}
              <button class="btn btn-ghost" data-simface-action="cancel" @click=${this.handleCancel}>Cancel</button>
            `
          : ''}
        ${this.captureState === 'error'
          ? html`
              <button class="btn btn-primary" data-simface-action="retry" @click=${this.beginCapture}>Try again</button>
              <button class="btn btn-ghost" data-simface-action="cancel" @click=${this.handleCancel}>Cancel</button>
            `
          : ''}
      </div>
    `;
  }

  private async beginCapture() {
    if (!this.active || this.captureState === 'starting' || this.captureState === 'live') {
      return;
    }

    this.stopSession();
    this.resetState();
    this.captureState = 'starting';
    this.feedbackMessage = 'Requesting camera access...';
    this.feedbackTone = 'neutral';

    const options = normalizeCaptureOptions({
      presentation: 'embedded',
      capturePreference: this.capturePreference,
      allowMediaPickerFallback: this.allowMediaPickerFallback,
      label: this.label,
      confirmLabel: this.confirmLabel,
    });
    const capabilities = await resolveCaptureCapabilities({
      capturePreference: options.capturePreference,
    });
    const plan = buildCapturePlan(options, capabilities);
    const cameraStep = plan.steps.find((step) => step === 'auto-camera' || step === 'manual-camera') ?? null;
    const hasMediaPickerFallback = plan.steps.includes('media-picker');

    if (!cameraStep) {
      await this.startMediaPicker();
      return;
    }

    try {
      this.stream = await openUserFacingCameraStream();
    } catch (error) {
      if (error instanceof CameraAccessError && hasMediaPickerFallback) {
        await this.startMediaPicker();
        return;
      }

      this.handleCaptureError(error);
      return;
    }

    await this.updateComplete;

    if (!this.active) {
      this.stopSession();
      return;
    }

    const video = this.embeddedVideoElement;
    if (!video || !this.stream) {
      this.handleCaptureError(new Error('Inline camera preview could not be created.'));
      return;
    }

    video.srcObject = this.stream;
    this.currentCaptureStep = cameraStep;
    this.sessionController = new CameraCaptureSessionController({
      videoElement: video,
      initialMode: cameraStep === 'auto-camera' ? 'auto' : 'manual',
      copy: {
        autoReadyMessage: 'Center your face in the oval. We will capture automatically when framing looks good.',
        manualReadyMessage: 'When you are ready, press Take photo.',
        autoUnavailableMessage: 'Automatic capture is unavailable. Press Take photo instead.',
        retakeReadyMessage: 'When you are ready, press Take photo.',
      },
      onStateChange: (state) => this.applySessionState(state),
    });

    try {
      await this.sessionController.start();
    } catch (error) {
      this.handleCaptureError(error);
    }
  }

  private async startMediaPicker() {
    this.stopSession();
    this.currentCaptureStep = 'media-picker';
    this.captureState = 'starting';
    this.feedbackMessage = 'Opening media picker...';
    this.feedbackTone = 'neutral';

    try {
      const blob = await captureFromFileInput();
      if (!blob) {
        this.handleCancel();
        return;
      }

      await this.showPickedPreview(blob);
    } catch (error) {
      this.handleCaptureError(error);
    }
  }

  private applySessionState(state: CameraCaptureSessionState) {
    this.captureState = state.phase;
    this.feedbackMessage = state.feedbackMessage;
    this.feedbackTone = state.feedbackTone;
    this.syncProgress(state.countdownProgress);
    this.qualityResult = state.qualityResult;
    this.errorMessage = state.phase === 'error' ? state.errorMessage : '';
    this.canTakePhoto = state.canTakePhoto;
    this.captureMode = state.mode;

    if (state.phase === 'preview') {
      this.capturedBlob = state.previewBlob;
      this.setPreviewBlob(state.previewBlob);
      return;
    }

    this.capturedBlob = null;
    this.clearPreviewUrl();
  }

  private async showPickedPreview(blob: Blob) {
    const qualityResult = await this.assessPickedBlob(blob);
    this.capturedBlob = blob;
    this.qualityResult = qualityResult;
    this.captureState = 'preview';
    this.feedbackMessage = qualityResult?.message ?? 'Review this capture before continuing.';
    this.feedbackTone = qualityResult
      ? qualityResult.passesQualityChecks
        ? 'success'
        : 'error'
      : 'neutral';
    this.syncProgress(qualityResult ? 1 : 0);
    this.setPreviewBlob(blob);
  }

  private handleManualCapture() {
    void this.sessionController?.takePhotoNow().catch((error) => {
      this.handleCaptureError(error);
    });
  }

  private handleRetake() {
    this.capturedBlob = null;
    this.qualityResult = null;
    this.clearPreviewUrl();

    if (this.currentCaptureStep === 'media-picker') {
      if (this.active) {
        void this.beginCapture();
      }
      return;
    }

    void this.sessionController?.retake().catch((error) => {
      this.handleCaptureError(error);
    });
  }

  private handleConfirm() {
    if (!this.capturedBlob) {
      return;
    }

    const blob = this.capturedBlob;
    this.active = false;
    this.stopSession();
    this.resetState();
    this.dispatchCaptured(blob);
  }

  private handleCancel() {
    this.active = false;
    this.stopSession();
    this.resetState();
    this.dispatchCancelled();
  }

  private handleCaptureError(error: unknown) {
    this.stopSession();
    this.errorMessage = error instanceof Error ? error.message : 'Capture failed';
    this.captureState = 'error';
    this.feedbackMessage = this.errorMessage;
    this.feedbackTone = 'error';
    this.dispatchError(this.errorMessage);
  }

  private endCapture() {
    this.stopSession();
    this.resetState();
  }

  private stopSession() {
    this.sessionController?.stop();
    this.sessionController = null;
    this.currentCaptureStep = null;

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    const video = this.embeddedVideoElement;
    if (video) {
      video.srcObject = null;
    }

    this.syncProgress(0);
  }

  private resetState() {
    this.clearPreviewUrl();
    this.captureState = 'idle';
    this.errorMessage = '';
    this.feedbackMessage = 'Start a capture to see camera guidance here.';
    this.feedbackTone = 'neutral';
    this.syncProgress(0);
    this.qualityResult = null;
    this.capturedBlob = null;
    this.captureMode = 'auto';
  }

  private syncProgress(progress: number) {
    this.style.setProperty('--capture-progress', String(progress));
  }

  private setPreviewBlob(blob: Blob) {
    this.clearPreviewUrl();
    this.previewUrl = URL.createObjectURL(blob);
  }

  private clearPreviewUrl() {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = '';
    }
  }

  private dispatchCaptured(blob: Blob) {
    this.dispatchEvent(new CustomEvent('simface-captured', {
      detail: { imageBlob: blob },
      bubbles: true,
      composed: true,
    }));
  }

  private dispatchCancelled() {
    this.dispatchEvent(new CustomEvent('simface-cancelled', {
      bubbles: true,
      composed: true,
    }));
  }

  private dispatchError(message: string) {
    this.dispatchEvent(new CustomEvent('simface-error', {
      detail: { error: message },
      bubbles: true,
      composed: true,
    }));
  }

  private feedbackClass() {
    if (this.feedbackTone === 'success') {
      return 'quality-good';
    }

    if (this.feedbackTone === 'error') {
      return 'quality-bad';
    }

    if (this.feedbackTone === 'manual') {
      return 'quality-manual';
    }

    return 'quality-neutral';
  }

  private async assessPickedBlob(blob: Blob): Promise<FaceQualityResult | null> {
    try {
      const image = await blobToImage(blob);
      return await assessFaceQuality(image);
    } catch {
      return null;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'simface-capture': SimFaceCapture;
  }
}
