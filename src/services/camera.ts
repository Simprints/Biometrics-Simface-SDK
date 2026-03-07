/**
 * Camera capture service.
 *
 * Uses in-browser camera capture for standard browsers and falls back to the
 * native file-input capture flow for WhatsApp, where that behavior is more reliable.
 */

const CAPTURE_DIALOG_Z_INDEX = '2147483647';

/**
 * Opens the device camera and returns a captured image Blob, or null if cancelled.
 */
export async function captureFromCamera(): Promise<Blob | null> {
  if (prefersNativeCameraCapture()) {
    return captureFromFileInput();
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('In-browser camera capture is not supported in this browser.');
  }

  return captureFromMediaDevices();
}

async function captureFromMediaDevices(): Promise<Blob | null> {
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
    let overlay: HTMLDivElement | null = null;
    let handleEscape: ((event: KeyboardEvent) => void) | null = null;

    const cleanup = () => {
      if (handleEscape) {
        window.removeEventListener('keydown', handleEscape);
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
      })

      const panel = document.createElement('div');
      applyStyles(panel, {
        width: 'min(100%, 520px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '20px',
        borderRadius: '18px',
        background: '#020617',
        color: '#e2e8f0',
        boxShadow: '0 24px 60px rgba(15, 23, 42, 0.35)',
      });

      const title = document.createElement('h2');
      title.textContent = 'Capture a face photo';
      applyStyles(title, {
        margin: '0',
        fontSize: '1.25rem',
        fontWeight: '700',
      });

      const copy = document.createElement('p');
      copy.textContent = 'Allow camera access, then position your face and take a photo.';
      applyStyles(copy, {
        margin: '0',
        color: '#cbd5e1',
        fontSize: '0.95rem',
        lineHeight: '1.5',
      });

      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      applyStyles(video, {
        width: '100%',
        minHeight: '280px',
        borderRadius: '14px',
        background: '#000',
        objectFit: 'cover',
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
      captureButton.disabled = true;

      actions.append(cancelButton, captureButton);
      panel.append(title, copy, video, actions);
      overlay.append(panel);
      document.body.appendChild(overlay);

      handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          finalize(null);
        }
      };

      cancelButton.addEventListener('click', () => finalize(null));
      window.addEventListener('keydown', handleEscape);

      captureButton.addEventListener('click', async () => {
        try {
          const blob = await captureVideoFrame(video);
          finalize(blob);
        } catch (error) {
          finalize(null, error instanceof Error ? error : new Error('Failed to capture an image.'));
        }
      });

      waitForVideoReady(video)
        .then(() => {
          captureButton.disabled = false;
        })
        .catch((error) => {
          finalize(null, error instanceof Error ? error : new Error('Failed to start the camera preview.'));
        });
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

function createActionButton(label: string, variant: 'primary' | 'secondary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;

  applyStyles(button, {
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
