import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { captureFromCamera, blobToImage, blobToDataURL } from '../services/camera.js';
import { assessFaceQuality } from '../services/face-detection.js';
import type { FaceQualityResult } from '../types/index.js';

type CaptureState = 'idle' | 'capturing' | 'analyzing' | 'preview' | 'error';

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

  @state() private captureState: CaptureState = 'idle';
  @state() private previewUrl = '';
  @state() private qualityResult: FaceQualityResult | null = null;
  @state() private errorMessage = '';

  private capturedBlob: Blob | null = null;

  static styles = css`
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 400px;
      margin: 0 auto;
      text-align: center;
    }

    .container {
      padding: 16px;
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      background: #fafafa;
    }

    .preview-img {
      max-width: 100%;
      border-radius: 8px;
      margin: 12px 0;
    }

    .btn {
      display: inline-block;
      padding: 12px 24px;
      margin: 8px 4px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .btn-primary {
      background: #2563eb;
      color: white;
    }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }

    .btn-secondary {
      background: #e5e7eb;
      color: #374151;
    }
    .btn-secondary:hover { background: #d1d5db; }

    .btn-danger {
      background: #ef4444;
      color: white;
    }
    .btn-danger:hover { background: #dc2626; }

    .quality-msg {
      padding: 8px 12px;
      border-radius: 6px;
      margin: 8px 0;
      font-size: 14px;
    }

    .quality-good { background: #dcfce7; color: #166534; }
    .quality-bad { background: #fef2f2; color: #991b1b; }

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

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;

  render() {
    return html`
      <div class="container">
        ${this.renderState()}
      </div>
    `;
  }

  private renderState() {
    switch (this.captureState) {
      case 'idle':
        return html`
          <p>${this.label}</p>
          <button class="btn btn-primary" @click=${this.handleCapture}>
            📷 Open Camera
          </button>
        `;

      case 'capturing':
        return html`
          <p>Opening camera...</p>
          <div class="spinner"></div>
        `;

      case 'analyzing':
        return html`
          <p>Checking image quality...</p>
          <div class="spinner"></div>
        `;

      case 'preview':
        return html`
          ${this.previewUrl
            ? html`<img class="preview-img" src=${this.previewUrl} alt="Captured face" />`
            : ''}
          ${this.qualityResult
            ? html`
                <div class="quality-msg ${this.qualityResult.isCentered && this.qualityResult.hasFace ? 'quality-good' : 'quality-bad'}">
                  ${this.qualityResult.message}
                </div>
              `
            : ''}
          ${this.qualityResult?.isCentered && this.qualityResult?.hasFace
            ? html`
                <button class="btn btn-primary" @click=${this.handleConfirm}>✓ Use this photo</button>
                <button class="btn btn-secondary" @click=${this.handleRetake}>↻ Retake</button>
              `
            : html`
                <button class="btn btn-primary" @click=${this.handleRetake}>↻ Try again</button>
                <button class="btn btn-secondary" @click=${this.handleCancel}>Cancel</button>
              `}
        `;

      case 'error':
        return html`
          <div class="quality-msg quality-bad">${this.errorMessage}</div>
          <button class="btn btn-primary" @click=${this.handleRetake}>↻ Try again</button>
          <button class="btn btn-secondary" @click=${this.handleCancel}>Cancel</button>
        `;
    }
  }

  private async handleCapture() {
    this.captureState = 'capturing';

    try {
      const blob = await captureFromCamera();
      if (!blob) {
        this.captureState = 'idle';
        return;
      }

      this.captureState = 'analyzing';
      this.capturedBlob = blob;
      this.previewUrl = await blobToDataURL(blob);

      const img = await blobToImage(blob);
      this.qualityResult = await assessFaceQuality(img);
      this.captureState = 'preview';
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Capture failed';
      this.captureState = 'error';
      this.dispatchEvent(new CustomEvent('simface-error', {
        detail: { error: this.errorMessage },
        bubbles: true,
        composed: true,
      }));
    }
  }

  private handleConfirm() {
    if (!this.capturedBlob) return;

    this.dispatchEvent(new CustomEvent('simface-captured', {
      detail: { imageBlob: this.capturedBlob },
      bubbles: true,
      composed: true,
    }));

    this.reset();
  }

  private handleRetake() {
    this.reset();
    this.handleCapture();
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent('simface-cancelled', {
      bubbles: true,
      composed: true,
    }));
    this.reset();
  }

  private reset() {
    this.captureState = 'idle';
    this.previewUrl = '';
    this.qualityResult = null;
    this.capturedBlob = null;
    this.errorMessage = '';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'simface-capture': SimFaceCapture;
  }
}
