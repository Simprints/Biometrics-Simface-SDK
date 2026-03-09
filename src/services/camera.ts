/**
 * Camera capture service.
 *
 * Uses realtime face guidance with automatic capture when supported and falls
 * back to a simpler manual capture flow when the browser cannot support it.
 */

import { assessFaceQuality, assessFaceQualityForVideo, getVideoDetector } from './face-detection.js';
import type { FaceQualityResult } from '../types/index.js';

const CAPTURE_DIALOG_Z_INDEX = '2147483647';
const AUTO_CAPTURE_ANALYSIS_INTERVAL_MS = 180;
const AUTO_CAPTURE_STABLE_FRAMES = 3;

type CaptureMode = 'auto' | 'manual';

/**
 * Opens the device camera and returns a confirmed image Blob, or null if cancelled.
 */
export async function captureFromCamera(): Promise<Blob | null> {
  if (prefersNativeCameraCapture()) {
    return captureFromFileInput();
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('In-browser camera capture is not supported in this browser.');
  }

  const mode = (await supportsRealtimeAutoCapture()) ? 'auto' : 'manual';
  return captureFromMediaDevices(mode);
}

async function supportsRealtimeAutoCapture(): Promise<boolean> {
  if (
    typeof window.requestAnimationFrame !== 'function' ||
    typeof window.cancelAnimationFrame !== 'function'
  ) {
    return false;
  }

  if (!document.createElement('canvas').getContext('2d')) {
    return false;
  }

  try {
    await getVideoDetector();
    return true;
  } catch {
    return false;
  }
}

async function captureFromMediaDevices(initialMode: CaptureMode): Promise<Blob | null> {
  let stream: MediaStream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' } },
      audio: false,
    });
  } catch (error) {
    throw new Error(describeCameraError(error));
  }

  let streamStopped = false;
  const stopStream = () => {
    if (streamStopped) {
      return;
    }

    streamStopped = true;
    stream.getTracks().forEach((track) => track.stop());
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let mode = initialMode;
    let overlay: HTMLDivElement | null = null;
    let previewUrl = '';
    let previewBlob: Blob | null = null;
    let animationFrameId: number | null = null;
    let escapeHandler: ((event: KeyboardEvent) => void) | null = null;
    let lastAnalysisTimestamp = 0;
    let stableFrameCount = 0;
    let analysisInFlight = false;
    let previewActive = false;
    let videoReady = false;

    const cleanup = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      if (escapeHandler) {
        window.removeEventListener('keydown', escapeHandler);
      }

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      stopStream();
      overlay?.remove();
    };

    const finalize = (value: Blob | null, error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (error) {
        reject(error);
        return;
      }

      resolve(value);
    };

    const renderCaptureMode = (
      video: HTMLVideoElement,
      mediaContainer: HTMLDivElement,
      title: HTMLHeadingElement,
      copy: HTMLParagraphElement,
      feedback: HTMLDivElement,
      actions: HTMLDivElement,
      cancelButton: HTMLButtonElement,
      captureButton: HTMLButtonElement,
    ) => {
      previewActive = false;
      stableFrameCount = 0;
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = '';
      }
      previewBlob = null;

      mediaContainer.replaceChildren(video, createGuideOverlay());
      if (videoReady) {
        resumeVideoPreview(video);
      }
      title.textContent = mode === 'auto' ? 'Center your face' : 'Take a face photo';
      copy.textContent =
        mode === 'auto'
          ? 'Keep your face inside the oval. We will capture automatically when the framing looks good.'
          : 'Line up your face in the oval, then take a photo manually.';

      feedback.textContent =
        mode === 'auto'
          ? 'Looking for a single face in frame...'
          : 'When you are ready, press Take photo.';
      setFeedbackState(feedback, mode === 'auto' ? 'neutral' : 'manual');

      captureButton.style.display = mode === 'manual' ? 'inline-flex' : 'none';
      captureButton.disabled = true;
      actions.replaceChildren(cancelButton, captureButton);
    };

    const renderPreviewMode = (
      video: HTMLVideoElement,
      mediaContainer: HTMLDivElement,
      title: HTMLHeadingElement,
      copy: HTMLParagraphElement,
      feedback: HTMLDivElement,
      actions: HTMLDivElement,
      cancelButton: HTMLButtonElement,
      confirmButton: HTMLButtonElement,
      retakeButton: HTMLButtonElement,
      blob: Blob,
      qualityResult: FaceQualityResult | null,
    ) => {
      previewActive = true;
      stableFrameCount = 0;

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      previewUrl = URL.createObjectURL(blob);
      previewBlob = blob;

      const image = document.createElement('img');
      image.alt = 'Captured face preview';
      image.src = previewUrl;
      applyStyles(image, {
        position: 'absolute',
        inset: '0',
        zIndex: '1',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      });

      mediaContainer.replaceChildren(video, image);
      title.textContent = 'Review your photo';
      copy.textContent =
        qualityResult?.passesQualityChecks === false
          ? 'The capture did not pass the checks. Retake the photo.'
          : 'Confirm this photo or retake it.';

      feedback.textContent = qualityResult?.message ?? 'Review the captured image before continuing.';
      setFeedbackState(
        feedback,
        qualityResult
          ? qualityResult.passesQualityChecks
            ? 'success'
            : 'error'
          : 'manual',
      );

      actions.replaceChildren(cancelButton, retakeButton);

      if (qualityResult?.passesQualityChecks !== false) {
        actions.append(confirmButton);
      }
    };

    try {
      overlay = document.createElement('div');
      overlay.setAttribute('data-simface-camera-overlay', 'true');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      applyStyles(overlay, {
        position: 'fixed',
        inset: '0',
        zIndex: CAPTURE_DIALOG_Z_INDEX,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'rgba(15, 23, 42, 0.82)',
      });

      const panel = document.createElement('div');
      applyStyles(panel, {
        width: 'min(100%, 560px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '20px',
        borderRadius: '20px',
        background: '#020617',
        color: '#e2e8f0',
        boxShadow: '0 24px 60px rgba(15, 23, 42, 0.35)',
      });

      const title = document.createElement('h2');
      applyStyles(title, {
        margin: '0',
        fontSize: '1.25rem',
        fontWeight: '700',
      });

      const copy = document.createElement('p');
      applyStyles(copy, {
        margin: '0',
        color: '#cbd5e1',
        fontSize: '0.95rem',
        lineHeight: '1.5',
      });

      const mediaContainer = document.createElement('div');
      applyStyles(mediaContainer, {
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        aspectRatio: '3 / 4',
        minHeight: '320px',
        borderRadius: '18px',
        background: '#000',
      });

      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      applyStyles(video, {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      });

      const feedback = document.createElement('div');
      applyStyles(feedback, {
        borderRadius: '14px',
        padding: '12px 14px',
        font: '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      });

      const actions = document.createElement('div');
      applyStyles(actions, {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        justifyContent: 'flex-end',
      });

      const cancelButton = createActionButton('Cancel', 'secondary');
      cancelButton.dataset.simfaceAction = 'cancel';

      const captureButton = createActionButton('Take photo', 'primary');
      captureButton.dataset.simfaceAction = 'capture';
      captureButton.style.display = mode === 'manual' ? 'inline-flex' : 'none';
      captureButton.disabled = true;

      const confirmButton = createActionButton('Use photo', 'primary');
      confirmButton.dataset.simfaceAction = 'confirm';

      const retakeButton = createActionButton('Retake', 'secondary');
      retakeButton.dataset.simfaceAction = 'retake';

      panel.append(title, copy, mediaContainer, feedback, actions);
      overlay.append(panel);
      document.body.appendChild(overlay);

      renderCaptureMode(video, mediaContainer, title, copy, feedback, actions, cancelButton, captureButton);

      escapeHandler = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          finalize(null);
        }
      };

      cancelButton.addEventListener('click', () => finalize(null));

      confirmButton.addEventListener('click', async () => {
        if (!previewBlob) {
          finalize(null, new Error('Failed to confirm the photo.'));
          return;
        }

        finalize(previewBlob);
      });

      retakeButton.addEventListener('click', () => {
        renderCaptureMode(video, mediaContainer, title, copy, feedback, actions, cancelButton, captureButton);
        if (mode === 'manual' && videoReady) {
          captureButton.disabled = false;
        }
        if (mode === 'auto') {
          scheduleAutoCapture();
        }
      });

      captureButton.addEventListener('click', async () => {
        if (previewActive) {
          return;
        }

        try {
          const blob = await captureVideoFrame(video);
          const qualityResult = await assessCapturedBlobSafely(blob);
          renderPreviewMode(
            video,
            mediaContainer,
            title,
            copy,
            feedback,
            actions,
            cancelButton,
            confirmButton,
            retakeButton,
            blob,
            qualityResult,
          );
        } catch (error) {
          finalize(null, error instanceof Error ? error : new Error('Failed to capture an image.'));
        }
      });

      window.addEventListener('keydown', escapeHandler);

      waitForVideoReady(video)
        .then(() => {
          videoReady = true;
          if (mode === 'manual') {
            captureButton.disabled = false;
            return;
          }

          scheduleAutoCapture();
        })
        .catch((error) => {
          finalize(null, error instanceof Error ? error : new Error('Failed to start the camera preview.'));
        });

      function scheduleAutoCapture() {
        if (settled || previewActive || mode !== 'auto') {
          return;
        }

        animationFrameId = window.requestAnimationFrame(async (timestamp) => {
          if (
            previewActive ||
            analysisInFlight ||
            timestamp - lastAnalysisTimestamp < AUTO_CAPTURE_ANALYSIS_INTERVAL_MS
          ) {
            scheduleAutoCapture();
            return;
          }

          lastAnalysisTimestamp = timestamp;
          analysisInFlight = true;

          try {
            const qualityResult = await assessFaceQualityForVideo(video, timestamp);
            feedback.textContent = qualityResult.message;
            setFeedbackState(feedback, qualityResult.passesQualityChecks ? 'success' : 'neutral');

            if (qualityResult.passesQualityChecks) {
              stableFrameCount += 1;
            } else {
              stableFrameCount = 0;
            }

            if (stableFrameCount >= AUTO_CAPTURE_STABLE_FRAMES) {
              const blob = await captureVideoFrame(video);
              renderPreviewMode(
                video,
                mediaContainer,
                title,
                copy,
                feedback,
                actions,
                cancelButton,
                confirmButton,
                retakeButton,
                blob,
                qualityResult,
              );
              return;
            }
          } catch (error) {
            mode = 'manual';
            renderCaptureMode(video, mediaContainer, title, copy, feedback, actions, cancelButton, captureButton);
            captureButton.disabled = false;
            feedback.textContent = 'Automatic capture is unavailable in this browser. Use Take photo instead.';
            setFeedbackState(feedback, 'manual');
          } finally {
            analysisInFlight = false;
          }

          scheduleAutoCapture();
        });
      }
    } catch (error) {
      finalize(null, error instanceof Error ? error : new Error('Failed to open the camera capture UI.'));
    }
  });
}

function captureFromFileInput(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'user';
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    });

    const handleFocus = () => {
      setTimeout(() => {
        if (!input.files?.length) {
          cleanup();
          resolve(null);
        }
      }, 500);
    };

    window.addEventListener('focus', handleFocus, { once: true });

    function cleanup() {
      window.removeEventListener('focus', handleFocus);
      input.remove();
    }

    document.body.appendChild(input);
    input.click();
  });
}

function prefersNativeCameraCapture(): boolean {
  return /WhatsApp/i.test(navigator.userAgent);
}

async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    await video.play();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const handleReady = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Failed to start the camera preview.'));
    };

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', handleReady);
      video.removeEventListener('error', handleError);
    };

    video.addEventListener('loadedmetadata', handleReady, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });

  await video.play();
}

function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
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

function resumeVideoPreview(video: HTMLVideoElement) {
  void video.play().catch(() => {
    // Ignore resume failures here; capture flow already handles preview startup errors.
  });
}

async function assessCapturedBlobSafely(blob: Blob): Promise<FaceQualityResult | null> {
  try {
    const image = await blobToImage(blob);
    return await assessFaceQuality(image);
  } catch {
    return null;
  }
}

function createActionButton(label: string, variant: 'primary' | 'secondary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;

  applyStyles(button, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '999px',
    padding: '12px 18px',
    font: '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    cursor: 'pointer',
    color: variant === 'primary' ? '#fff' : '#0f172a',
    background: variant === 'primary' ? '#2563eb' : '#e2e8f0',
  });

  return button;
}

function createGuideOverlay(): HTMLDivElement {
  const wrapper = document.createElement('div');
  applyStyles(wrapper, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
  });

  const guide = document.createElement('div');
  applyStyles(guide, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '64%',
    height: '76%',
    transform: 'translate(-50%, -50%)',
    borderRadius: '999px',
    border: '3px solid rgba(255, 255, 255, 0.9)',
    boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.34)',
  });

  wrapper.append(guide);
  return wrapper;
}

function setFeedbackState(
  element: HTMLDivElement,
  state: 'neutral' | 'success' | 'error' | 'manual',
) {
  switch (state) {
    case 'success':
      applyStyles(element, {
        background: '#dcfce7',
        color: '#166534',
      });
      return;
    case 'error':
      applyStyles(element, {
        background: '#fee2e2',
        color: '#991b1b',
      });
      return;
    case 'manual':
      applyStyles(element, {
        background: '#e0f2fe',
        color: '#0f172a',
      });
      return;
    default:
      applyStyles(element, {
        background: '#e2e8f0',
        color: '#0f172a',
      });
  }
}

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
  Object.assign(element.style, styles);
}

function describeCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera access was denied. Allow camera access and try again.';
      case 'NotFoundError':
        return 'No camera was found on this device.';
      case 'NotReadableError':
        return 'The camera is already in use by another application.';
      default:
        return error.message || 'Failed to access the camera.';
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Failed to access the camera.';
}

/**
 * Loads a Blob as an HTMLImageElement for face detection analysis.
 */
export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load captured image'));
    };

    img.src = url;
  });
}

/**
 * Creates a data URL from a Blob for display in an <img> tag.
 */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}
