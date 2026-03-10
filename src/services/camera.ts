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
import type { SimFaceCaptureOptions } from '../types/index.js';

const CAPTURE_DIALOG_Z_INDEX = '2147483647';

type CaptureElement = HTMLElement & {
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

  // For popup, skip the expensive auto-capture probe (MediaPipe load) here.
  // We only need to know if a camera API is available; the full capabilities
  // resolution (including auto-capture) happens inside the component once the
  // UI is shown.  If there is no camera API, bypass the popup and go directly
  // to the media-picker fallback.
  const supportsMediaDevices = typeof navigator.mediaDevices?.getUserMedia === 'function';

  if (!supportsMediaDevices) {
    if (captureOptions.allowMediaPickerFallback) {
      return captureFromFileInput();
    }

    throw new Error('No supported capture strategy is available in this environment.');
  }

  return captureFromPopupCamera(captureOptions);
}

async function captureFromEmbeddedComponent(
  options: NormalizedCaptureOptions,
): Promise<Blob | null> {
  await import('../components/simface-capture.js');

  const host = resolveEmbeddedCaptureHost(options.container);
  const usingExistingElement = host.tagName.toLowerCase() === 'simface-capture';
  const element = (usingExistingElement
    ? host
    : document.createElement('simface-capture')) as CaptureElement;

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

    const element = document.createElement('simface-capture') as CaptureElement;
    element.label = options.label;
    element.confirmLabel = options.confirmLabel;
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
