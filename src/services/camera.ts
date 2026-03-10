/**
 * Camera capture service.
 *
 * Plans capture explicitly as an ordered fallback chain:
 * auto camera -> manual camera -> media picker.
 */

import {
  CAPTURE_GUIDE_MASK_PATH,
  CAPTURE_GUIDE_PATH,
} from '../shared/auto-capture.js';
import {
  buildCapturePlan,
  normalizeCaptureOptions,
  resolveCaptureCapabilities,
  type NormalizedCaptureOptions,
} from '../shared/capture-flow.js';
import {
  CameraCaptureSessionController,
  type CameraCaptureSessionState,
  type LiveCaptureMode,
} from '../shared/capture-session.js';
import {
  CameraAccessError,
  blobToDataURL,
  blobToImage,
  captureFromFileInput,
  openUserFacingCameraStream,
} from '../shared/capture-runtime.js';
import type { SimFaceCaptureOptions } from '../types/index.js';

const CAPTURE_DIALOG_Z_INDEX = '2147483647';

type GuideOverlayControls = {
  wrapper: HTMLDivElement;
  setProgress: (value: number) => void;
};

type EmbeddedCaptureElement = HTMLElement & {
  embedded: boolean;
  active: boolean;
  label: string;
  confirmLabel: string;
  capturePreference: 'auto-preferred' | 'manual-only';
  allowMediaPickerFallback: boolean;
  startCapture: () => Promise<void>;
};

/**
 * Opens the configured capture presentation and returns a confirmed image Blob,
 * or null if the user cancels.
 */
export async function captureFromCamera(
  options?: SimFaceCaptureOptions,
): Promise<Blob | null> {
  const captureOptions = normalizeCaptureOptions(options);

  if (captureOptions.presentation === 'embedded') {
    return captureFromEmbeddedComponent(captureOptions);
  }

  const capabilities = await resolveCaptureCapabilities({
    capturePreference: captureOptions.capturePreference,
  });
  const plan = buildCapturePlan(captureOptions, capabilities);

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];

    if (step === 'media-picker') {
      return captureFromFileInput();
    }

    try {
      return await captureFromPopupCamera(step === 'auto-camera' ? 'auto' : 'manual');
    } catch (error) {
      const hasMediaPickerFallback = plan.steps.slice(index + 1).includes('media-picker');
      if (error instanceof CameraAccessError && hasMediaPickerFallback) {
        return captureFromFileInput();
      }

      throw error;
    }
  }

  throw new Error('No supported capture strategy is available in this environment.');
}

async function captureFromEmbeddedComponent(
  options: NormalizedCaptureOptions,
): Promise<Blob | null> {
  await import('../components/simface-capture.js');

  const host = resolveEmbeddedCaptureHost(options.container);
  const usingExistingElement = host.tagName.toLowerCase() === 'simface-capture';
  const element = (usingExistingElement
    ? host
    : document.createElement('simface-capture')) as EmbeddedCaptureElement;

  if (!usingExistingElement) {
    host.appendChild(element);
  }

  element.embedded = true;
  element.label = options.label;
  element.confirmLabel = options.confirmLabel;
  element.capturePreference = options.capturePreference;
  element.allowMediaPickerFallback = options.allowMediaPickerFallback;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener('simface-captured', handleCaptured as EventListener);
      element.removeEventListener('simface-cancelled', handleCancelled as EventListener);
      element.removeEventListener('simface-error', handleError as EventListener);
      element.active = false;

      if (!usingExistingElement) {
        element.remove();
      }
    };

    const handleCaptured = (event: CustomEvent<{ imageBlob: Blob }>) => {
      cleanup();
      resolve(event.detail.imageBlob);
    };

    const handleCancelled = () => {
      cleanup();
      resolve(null);
    };

    const handleError = (event: CustomEvent<{ error: string }>) => {
      cleanup();
      reject(new Error(event.detail.error));
    };

    element.addEventListener('simface-captured', handleCaptured as EventListener);
    element.addEventListener('simface-cancelled', handleCancelled as EventListener);
    element.addEventListener('simface-error', handleError as EventListener);

    void element.startCapture().catch((error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error('Embedded capture failed.'));
    });
  });
}

function resolveEmbeddedCaptureHost(container: HTMLElement | string | undefined): HTMLElement {
  if (!container) {
    throw new Error('Embedded capture requires a container element or selector.');
  }

  if (container instanceof HTMLElement) {
    return container;
  }

  const element = document.querySelector<HTMLElement>(container);
  if (!element) {
    throw new Error(`No element matched the embedded capture container selector "${container}".`);
  }

  return element;
}

async function captureFromPopupCamera(initialMode: LiveCaptureMode): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let overlay: HTMLDivElement | null = null;
    let previewUrl = '';
    let stream: MediaStream | null = null;
    let controller: CameraCaptureSessionController | null = null;
    let escapeHandler: ((event: KeyboardEvent) => void) | null = null;

    const cleanup = () => {
      controller?.stop();

      if (escapeHandler) {
        window.removeEventListener('keydown', escapeHandler);
      }

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

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
      applyStyles(video, {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: 'scaleX(-1)',
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

      const confirmButton = createActionButton('Use photo', 'primary');
      confirmButton.dataset.simfaceAction = 'confirm';

      const retakeButton = createActionButton('Retake', 'secondary');
      retakeButton.dataset.simfaceAction = 'retake';

      const guideOverlay = createGuideOverlay();

      panel.append(title, copy, mediaContainer, feedback, actions);
      overlay.append(panel);
      document.body.appendChild(overlay);

      escapeHandler = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          finalize(null);
        }
      };

      window.addEventListener('keydown', escapeHandler);
      cancelButton.addEventListener('click', () => finalize(null));
      captureButton.addEventListener('click', () => {
        void controller?.takePhotoNow().catch((error) => {
          finalize(null, error instanceof Error ? error : new Error('Failed to capture an image.'));
        });
      });
      retakeButton.addEventListener('click', () => {
        void controller?.retake().catch((error) => {
          finalize(null, error instanceof Error ? error : new Error('Failed to restart the capture.'));
        });
      });
      confirmButton.addEventListener('click', () => {
        try {
          const blob = controller?.confirm();
          finalize(blob ?? null);
        } catch (error) {
          finalize(null, error instanceof Error ? error : new Error('Failed to confirm the photo.'));
        }
      });

      controller = new CameraCaptureSessionController({
        videoElement: video,
        initialMode,
        copy: {
          autoReadyMessage: 'Looking for a single face in frame...',
          manualReadyMessage: 'When you are ready, press Take photo.',
          autoUnavailableMessage: 'Automatic capture is unavailable in this browser. Use Take photo instead.',
          retakeReadyMessage: 'When you are ready, press Take photo.',
        },
        onStateChange: (state) => {
          renderPopupState({
            state,
            mediaContainer,
            video,
            title,
            copy,
            feedback,
            actions,
            cancelButton,
            captureButton,
            confirmButton,
            retakeButton,
            guideOverlay,
            setPreviewUrl(nextUrl) {
              if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
              }

              previewUrl = nextUrl;
            },
          });
        },
      });

      void (async () => {
        try {
          stream = await openUserFacingCameraStream();
          if (settled) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          video.srcObject = stream;
          await controller?.start();
        } catch (error) {
          finalize(
            null,
            error instanceof Error ? error : new Error('Failed to open the camera capture UI.'),
          );
        }
      })();
    } catch (error) {
      finalize(
        null,
        error instanceof Error ? error : new Error('Failed to open the camera capture UI.'),
      );
    }
  });
}

type PopupRendererOptions = {
  state: CameraCaptureSessionState;
  mediaContainer: HTMLDivElement;
  video: HTMLVideoElement;
  title: HTMLHeadingElement;
  copy: HTMLParagraphElement;
  feedback: HTMLDivElement;
  actions: HTMLDivElement;
  cancelButton: HTMLButtonElement;
  captureButton: HTMLButtonElement;
  confirmButton: HTMLButtonElement;
  retakeButton: HTMLButtonElement;
  guideOverlay: GuideOverlayControls;
  setPreviewUrl: (url: string) => void;
};

function renderPopupState(options: PopupRendererOptions) {
  const {
    state,
    mediaContainer,
    video,
    title,
    copy,
    feedback,
    actions,
    cancelButton,
    captureButton,
    confirmButton,
    retakeButton,
    guideOverlay,
    setPreviewUrl,
  } = options;

  guideOverlay.setProgress(state.phase === 'live' && state.mode === 'auto' ? state.countdownProgress : 0);

  if (state.phase === 'preview') {
    const nextPreviewUrl = URL.createObjectURL(state.previewBlob);
    setPreviewUrl(nextPreviewUrl);

    const image = document.createElement('img');
    image.alt = 'Captured face preview';
    image.src = nextPreviewUrl;
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
    copy.textContent = state.qualityResult?.passesQualityChecks === false
      ? 'The capture did not pass the checks. Retake the photo.'
      : 'Confirm this photo or retake it.';
    feedback.textContent = state.feedbackMessage;
    setFeedbackState(feedback, state.feedbackTone);
    actions.replaceChildren(cancelButton, retakeButton);

    if (state.canConfirm) {
      actions.append(confirmButton);
    }

    return;
  }

  mediaContainer.replaceChildren(video, guideOverlay.wrapper);
  setPreviewUrl('');

  if (state.mode === 'auto') {
    title.textContent = state.phase === 'starting' ? 'Opening camera...' : 'Center your face';
    copy.textContent = 'Keep your face inside the oval. We will start a short countdown when the framing looks good and keep the best frame.';
  } else {
    title.textContent = state.phase === 'starting' ? 'Opening camera...' : 'Take a face photo';
    copy.textContent = 'Line up your face in the oval, then take a photo manually.';
  }

  feedback.textContent = state.phase === 'starting'
    ? 'Requesting camera access...'
    : state.feedbackMessage;
  setFeedbackState(
    feedback,
    state.phase === 'starting'
      ? 'neutral'
      : state.feedbackTone,
  );

  captureButton.style.display = state.phase === 'live' && state.mode === 'manual'
    ? 'inline-flex'
    : 'none';
  captureButton.disabled = !(state.phase === 'live' && state.mode === 'manual');
  actions.replaceChildren(cancelButton, captureButton);
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

function createGuideOverlay(): GuideOverlayControls {
  const wrapper = document.createElement('div');
  applyStyles(wrapper, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
  });

  const svg = createSvgElement('svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  applyStyles(svg, {
    width: '100%',
    height: '100%',
    display: 'block',
  });

  const mask = createSvgElement('path');
  mask.setAttribute('d', CAPTURE_GUIDE_MASK_PATH);
  mask.setAttribute('fill', 'rgba(51, 65, 85, 0.75)');
  mask.setAttribute('fill-rule', 'evenodd');

  const outline = createSvgElement('path');
  outline.setAttribute('d', CAPTURE_GUIDE_PATH);
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', 'rgba(255, 255, 255, 0.92)');
  outline.setAttribute('stroke-width', '2.8');
  outline.setAttribute('stroke-linecap', 'round');
  outline.setAttribute('stroke-linejoin', 'round');

  const progress = createSvgElement('path');
  progress.setAttribute('d', CAPTURE_GUIDE_PATH);
  progress.setAttribute('fill', 'none');
  progress.setAttribute('stroke', '#22c55e');
  progress.setAttribute('stroke-width', '2.8');
  progress.setAttribute('stroke-linecap', 'round');
  progress.setAttribute('stroke-linejoin', 'round');
  progress.setAttribute('pathLength', '100');
  progress.setAttribute('stroke-dasharray', '100');
  progress.setAttribute('stroke-dashoffset', '100');
  progress.style.transition = 'stroke-dashoffset 0.14s linear, opacity 0.14s linear';
  progress.style.opacity = '0';

  svg.append(mask, outline, progress);
  wrapper.append(svg);

  return {
    wrapper,
    setProgress(value: number) {
      const progressValue = Math.min(Math.max(value, 0), 1);
      progress.setAttribute('stroke-dashoffset', `${100 - progressValue * 100}`);
      progress.style.opacity = progressValue > 0 ? '1' : '0';
    },
  };
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tagName);
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

function applyStyles(element: HTMLElement | SVGElement, styles: Partial<CSSStyleDeclaration>) {
  Object.assign(element.style, styles);
}

export { blobToImage, blobToDataURL };
