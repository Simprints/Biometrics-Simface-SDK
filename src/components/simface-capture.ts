import { LitElement, html, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { blobToImage, captureFromCamera } from '../services/camera.js';
import { assessFaceQuality, assessFaceQualityForVideo } from '../services/face-detection.js';
import type { FaceQualityResult } from '../types/index.js';

type CaptureState = 'idle' | 'starting' | 'live' | 'preview' | 'error';
type FeedbackTone = 'neutral' | 'success' | 'error';

const AUTO_CAPTURE_ANALYSIS_INTERVAL_MS = 180;
const AUTO_CAPTURE_STABLE_FRAMES = 3;

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

  @state() private captureState: CaptureState = 'idle';
  @state() private errorMessage = '';
  @state() private feedbackMessage = 'Start a capture to see camera guidance here.';
  @state() private feedbackTone: FeedbackTone = 'neutral';
  @state() private previewUrl = '';
  @state() private qualityResult: FaceQualityResult | null = null;

  @query('#embedded-video') private embeddedVideoElement?: HTMLVideoElement;

  private stream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private analysisInFlight = false;
  private lastAnalysisTimestamp = 0;
  private stableFrameCount = 0;
  private capturedBlob: Blob | null = null;

  static styles = css`
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 400px;
      margin: 0 auto;
      text-align: center;
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

    .embedded-shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .embedded-copy {
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
    }

    .preview-img {
      position: absolute;
      inset: 0;
      z-index: 2;
    }

    .guide {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    .guide::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      width: 62%;
      height: 76%;
      transform: translate(-50%, -50%);
      border-radius: 999px;
      border: 3px solid rgba(255, 255, 255, 0.92);
      box-shadow: 0 0 0 9999px rgba(2, 6, 23, 0.38);
    }

    .btn-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .preview-img-inline {
      max-width: 100%;
      border-radius: 8px;
      margin: 12px 0;
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
    this.stopEmbeddedSession();
  }

  updated(changedProperties: Map<string, unknown>) {
    if (!this.embedded || !changedProperties.has('active')) {
      return;
    }

    if (this.active) {
      void this.startEmbeddedCapture();
      return;
    }

    this.stopEmbeddedSession();
    this.resetEmbeddedState();
  }

  render() {
    if (this.embedded) {
      return html`
        <div class="container embedded-shell">
          ${this.renderEmbeddedState()}
        </div>
      `;
    }

    return html`
      <div class="container">
        ${this.renderPopupState()}
      </div>
    `;
  }

  public async startCapture() {
    if (this.embedded) {
      this.active = true;
      await this.updateComplete;
      return;
    }

    await this.handlePopupCapture();
  }

  private renderPopupState() {
    switch (this.captureState) {
      case 'idle':
        return html`
          <p>${this.label}</p>
          <button class="btn btn-primary" @click=${this.handlePopupCapture}>
            Open Camera
          </button>
        `;

      case 'starting':
        return html`
          <p>Opening camera...</p>
          <div class="spinner"></div>
        `;

      case 'error':
        return html`
          <div class="quality-msg quality-bad">${this.errorMessage}</div>
          <button class="btn btn-primary" @click=${this.handlePopupRetake}>Try again</button>
          <button class="btn btn-secondary" @click=${this.handlePopupCancel}>Cancel</button>
        `;

      default:
        return html``;
    }
  }

  private renderEmbeddedState() {
    return html`
      <p class="embedded-copy">${this.label}</p>

      ${this.captureState === 'idle'
        ? html`<p class="embedded-copy">Waiting for the host page to start capture.</p>`
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
              <div class="guide ${this.captureState === 'live' || this.captureState === 'starting' ? '' : 'hidden'}"></div>
            </div>
          `}

      <div class="quality-msg ${this.feedbackClass()}">
        ${this.captureState === 'starting' ? 'Requesting camera access...' : this.feedbackMessage}
      </div>

      <div class="btn-row">
        ${this.captureState === 'live'
          ? html`
              <button class="btn btn-secondary" @click=${this.handleEmbeddedManualCapture}>Take photo now</button>
              <button class="btn btn-ghost" @click=${this.handleEmbeddedCancel}>Cancel</button>
            `
          : ''}
        ${this.captureState === 'preview'
          ? html`
              <button class="btn btn-secondary" @click=${this.handleEmbeddedRetake}>Retake</button>
              ${this.qualityResult?.passesQualityChecks === false
                ? ''
                : html`<button class="btn btn-primary" @click=${this.handleEmbeddedConfirm}>${this.confirmLabel}</button>`}
              <button class="btn btn-ghost" @click=${this.handleEmbeddedCancel}>Cancel</button>
            `
          : ''}
        ${this.captureState === 'error'
          ? html`
              <button class="btn btn-primary" @click=${this.startEmbeddedCapture}>Try again</button>
              <button class="btn btn-ghost" @click=${this.handleEmbeddedCancel}>Cancel</button>
            `
          : ''}
      </div>
    `;
  }

  private async handlePopupCapture() {
    this.captureState = 'starting';

    try {
      const blob = await captureFromCamera();
      if (!blob) {
        this.dispatchCancelled();
        this.captureState = 'idle';
        return;
      }

      this.dispatchCaptured(blob);
      this.resetPopupState();
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Capture failed';
      this.captureState = 'error';
      this.dispatchError(this.errorMessage);
    }
  }

  private handlePopupRetake() {
    this.resetPopupState();
    void this.handlePopupCapture();
  }

  private handlePopupCancel() {
    this.dispatchCancelled();
    this.resetPopupState();
  }

  private async startEmbeddedCapture() {
    if (!this.active || this.captureState === 'starting' || this.captureState === 'live') {
      return;
    }

    this.stopEmbeddedSession();
    this.resetEmbeddedState();
    this.captureState = 'starting';
    this.feedbackMessage = 'Requesting camera access...';
    this.feedbackTone = 'neutral';
    await this.updateComplete;

    if (!navigator.mediaDevices?.getUserMedia) {
      this.handleEmbeddedError(new Error('This browser does not support inline camera capture.'));
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' } },
        audio: false,
      });

      this.captureState = 'live';
      this.feedbackMessage = 'Center your face in the oval. We will capture automatically when framing looks good.';
      await this.updateComplete;

      const video = this.embeddedVideoElement;
      if (!video) {
        throw new Error('Inline camera preview could not be created.');
      }

      video.srcObject = this.stream;
      await this.waitForVideoReady(video);
      this.scheduleEmbeddedAnalysis();
    } catch (error) {
      this.handleEmbeddedError(error);
    }
  }

  private scheduleEmbeddedAnalysis() {
    if (this.captureState !== 'live' || !this.stream) {
      return;
    }

    if (
      typeof window.requestAnimationFrame !== 'function' ||
      typeof window.cancelAnimationFrame !== 'function'
    ) {
      this.feedbackMessage = 'Automatic analysis is unavailable. Use Take photo now.';
      this.feedbackTone = 'neutral';
      return;
    }

    this.animationFrameId = window.requestAnimationFrame(async (timestamp) => {
      if (
        this.captureState !== 'live' ||
        this.analysisInFlight ||
        timestamp - this.lastAnalysisTimestamp < AUTO_CAPTURE_ANALYSIS_INTERVAL_MS
      ) {
        this.scheduleEmbeddedAnalysis();
        return;
      }

      const video = this.embeddedVideoElement;
      if (!video) {
        return;
      }

      this.lastAnalysisTimestamp = timestamp;
      this.analysisInFlight = true;

      try {
        const qualityResult = await assessFaceQualityForVideo(video, timestamp);
        this.qualityResult = qualityResult;
        this.feedbackMessage = qualityResult.message;
        this.feedbackTone = qualityResult.passesQualityChecks ? 'success' : 'neutral';

        if (qualityResult.passesQualityChecks) {
          this.stableFrameCount += 1;
        } else {
          this.stableFrameCount = 0;
        }

        if (this.stableFrameCount >= AUTO_CAPTURE_STABLE_FRAMES) {
          await this.captureEmbeddedFrame();
          return;
        }
      } catch {
        this.feedbackMessage = 'Automatic analysis is unavailable. Use Take photo now.';
        this.feedbackTone = 'neutral';
        return;
      } finally {
        this.analysisInFlight = false;
      }

      this.scheduleEmbeddedAnalysis();
    });
  }

  private async captureEmbeddedFrame() {
    const video = this.embeddedVideoElement;
    if (!video || this.captureState !== 'live') {
      return;
    }

    try {
      const blob = await this.captureVideoFrame(video);
      const qualityResult = await this.assessCapturedBlob(blob);

      this.capturedBlob = blob;
      this.qualityResult = qualityResult;
      this.captureState = 'preview';
      this.feedbackMessage = qualityResult?.message ?? 'Review this capture before continuing.';
      this.feedbackTone = qualityResult
        ? qualityResult.passesQualityChecks
          ? 'success'
          : 'error'
        : 'neutral';

      if (this.previewUrl) {
        URL.revokeObjectURL(this.previewUrl);
      }

      this.previewUrl = URL.createObjectURL(blob);
    } catch (error) {
      this.handleEmbeddedError(error);
    }
  }

  private async assessCapturedBlob(blob: Blob): Promise<FaceQualityResult | null> {
    try {
      const image = await blobToImage(blob);
      return await assessFaceQuality(image);
    } catch {
      return null;
    }
  }

  private handleEmbeddedManualCapture() {
    void this.captureEmbeddedFrame();
  }

  private handleEmbeddedRetake() {
    this.capturedBlob = null;
    this.qualityResult = null;
    this.stableFrameCount = 0;
    this.captureState = 'live';

    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = '';
    }

    this.feedbackMessage = 'Ready to capture again.';
    this.feedbackTone = 'neutral';
    this.resumeEmbeddedVideo();
    this.scheduleEmbeddedAnalysis();
  }

  private handleEmbeddedConfirm() {
    if (!this.capturedBlob) {
      return;
    }

    const blob = this.capturedBlob;
    this.active = false;
    this.stopEmbeddedSession();
    this.resetEmbeddedState();
    this.dispatchCaptured(blob);
  }

  private handleEmbeddedCancel() {
    this.active = false;
    this.stopEmbeddedSession();
    this.resetEmbeddedState();
    this.dispatchCancelled();
  }

  private handleEmbeddedError(error: unknown) {
    this.stopEmbeddedSession();
    this.errorMessage = error instanceof Error ? error.message : 'Capture failed';
    this.captureState = 'error';
    this.feedbackMessage = this.errorMessage;
    this.feedbackTone = 'error';
    this.dispatchError(this.errorMessage);
  }

  private stopEmbeddedSession() {
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    const video = this.embeddedVideoElement;
    if (video) {
      video.srcObject = null;
    }

    this.analysisInFlight = false;
    this.lastAnalysisTimestamp = 0;
    this.stableFrameCount = 0;
  }

  private resetEmbeddedState() {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = '';
    }

    this.captureState = 'idle';
    this.errorMessage = '';
    this.feedbackMessage = 'Start a capture to see camera guidance here.';
    this.feedbackTone = 'neutral';
    this.qualityResult = null;
    this.capturedBlob = null;
  }

  private resetPopupState() {
    this.captureState = 'idle';
    this.errorMessage = '';
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

    return 'quality-neutral';
  }

  private waitForVideoReady(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return video.play().then(() => undefined);
    }

    return new Promise((resolve, reject) => {
      const handleReady = () => {
        cleanup();
        video.play().then(() => resolve()).catch(reject);
      };

      const handleError = () => {
        cleanup();
        reject(new Error('Failed to start the inline camera preview.'));
      };

      const cleanup = () => {
        video.removeEventListener('loadedmetadata', handleReady);
        video.removeEventListener('error', handleError);
      };

      video.addEventListener('loadedmetadata', handleReady, { once: true });
      video.addEventListener('error', handleError, { once: true });
    });
  }

  private captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
    if (!video.videoWidth || !video.videoHeight) {
      return Promise.reject(new Error('Camera preview is not ready yet.'));
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      return Promise.reject(new Error('Failed to initialize camera capture.'));
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to capture an image.'));
          return;
        }

        resolve(blob);
      }, 'image/jpeg', 0.92);
    });
  }

  private resumeEmbeddedVideo() {
    const video = this.embeddedVideoElement;
    if (!video) {
      return;
    }

    void video.play().catch(() => {
      // Ignore replay failures here; the initial preview startup path already errors loudly.
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'simface-capture': SimFaceCapture;
  }
}
