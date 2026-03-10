/**
 * Camera capture service.
 *
 * Plans capture explicitly as an ordered fallback chain:
 * auto camera -> manual camera -> media picker.
 */

import {
  normalizeCaptureOptions,
  type NormalizedCaptureOptions,
} from '../shared/capture-flow.js';
import {
  blobToDataURL,
  blobToImage,
  captureFromFileInput,
} from '../shared/capture-runtime.js';
import type {
  SimFaceCaptureElement,
  SimFaceCaptureOptions,
  SimFaceWorkflowOptions,
} from '../types/index.js';

const CAPTURE_DIALOG_Z_INDEX = '2147483647';

/**
 * Opens the configured capture flow and returns a confirmed image Blob,
 * or null if the user cancels.
 */
export async function captureFromCamera(
  workflowOptions?: SimFaceWorkflowOptions,
  captureOptions?: SimFaceCaptureOptions,
): Promise<Blob | null> {
  const normalizedOptions = normalizeCaptureOptions(workflowOptions, captureOptions);

  if (captureOptions) {
    return captureFromEmbeddedComponent(normalizedOptions);
  }

  // For popup, skip the expensive auto-capture probe (MediaPipe load) here.
  // We only need to know if a camera API is available; the full capabilities
  // resolution (including auto-capture) happens inside the component once the
  // UI is shown.  If there is no camera API, bypass the popup and go directly
  // to the media-picker fallback.
  const supportsMediaDevices = typeof navigator.mediaDevices?.getUserMedia === 'function';

  if (!supportsMediaDevices) {
    if (normalizedOptions.allowMediaPickerFallback) {
      return captureFromFileInput();
    }

    throw new Error('No supported capture strategy is available in this environment.');
  }

  return captureFromPopupCamera(normalizedOptions);
}

async function captureFromEmbeddedComponent(
  options: NormalizedCaptureOptions,
): Promise<Blob | null> {
  await import('../components/simface-capture.js');

  const element = resolveEmbeddedCaptureComponent(options.component);

  element.embedded = true;
  element.label = options.label;
  element.confirmLabel = options.confirmLabel;
  element.captureLabel = options.captureLabel;
  element.retakeLabel = options.retakeLabel;
  element.retryLabel = options.retryLabel;
  element.capturePreference = options.capturePreference;
  element.allowMediaPickerFallback = options.allowMediaPickerFallback;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener('simface-captured', handleCaptured as EventListener);
      element.removeEventListener('simface-cancelled', handleCancelled as EventListener);
      element.removeEventListener('simface-error', handleError as EventListener);
      element.active = false;
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

function resolveEmbeddedCaptureComponent(
  component: SimFaceCaptureElement | undefined,
): SimFaceCaptureElement {
  if (!component) {
    throw new Error('Embedded capture requires a simface-capture component.');
  }

  if (component.tagName.toLowerCase() !== 'simface-capture') {
    throw new Error('Embedded capture requires a simface-capture component.');
  }

  return component;
}

async function captureFromPopupCamera(
  options: NormalizedCaptureOptions,
): Promise<Blob | null> {
  await import('../components/simface-capture.js');

  return new Promise((resolve, reject) => {
    let settled = false;
    let escapeHandler: ((event: KeyboardEvent) => void) | null = null;

    const overlay = document.createElement('div');
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
      colorScheme: 'light',
    });

    const element = document.createElement('simface-capture') as SimFaceCaptureElement;
    element.label = options.label;
    element.confirmLabel = options.confirmLabel;
    element.captureLabel = options.captureLabel;
    element.retakeLabel = options.retakeLabel;
    element.retryLabel = options.retryLabel;
    element.capturePreference = options.capturePreference;
    element.allowMediaPickerFallback = options.allowMediaPickerFallback;

    overlay.appendChild(element);
    document.body.appendChild(overlay);

    const cleanup = () => {
      if (escapeHandler) {
        window.removeEventListener('keydown', escapeHandler);
      }

      element.removeEventListener('simface-captured', handleCaptured as EventListener);
      element.removeEventListener('simface-cancelled', handleCancelled as EventListener);
      element.removeEventListener('simface-error', handleError as EventListener);
      element.active = false;
      overlay.remove();
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

    const handleCaptured = (event: CustomEvent<{ imageBlob: Blob }>) => {
      finalize(event.detail.imageBlob);
    };

    const handleCancelled = () => {
      finalize(null);
    };

    const handleError = (event: CustomEvent<{ error: string }>) => {
      finalize(null, new Error(event.detail.error));
    };

    escapeHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finalize(null);
      }
    };

    element.addEventListener('simface-captured', handleCaptured as EventListener);
    element.addEventListener('simface-cancelled', handleCancelled as EventListener);
    element.addEventListener('simface-error', handleError as EventListener);
    window.addEventListener('keydown', escapeHandler);

    void element.startCapture().catch((error) => {
      finalize(null, error instanceof Error ? error : new Error('Popup capture failed.'));
    });
  });
}

function applyStyles(element: HTMLElement | SVGElement, styles: Partial<CSSStyleDeclaration>) {
  Object.assign(element.style, styles);
}

export { blobToImage, blobToDataURL };
