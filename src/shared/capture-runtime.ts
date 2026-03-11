export class CameraAccessError extends Error {
  override name = 'CameraAccessError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        value: options.cause,
      });
    }
  }
}

export interface ReusableFrameCapture {
  captureBlob: (video: HTMLVideoElement) => Promise<Blob>;
  /** Snapshot the current video frame to an internal working canvas. */
  captureWorkingFrame: (video: HTMLVideoElement) => void;
  /** Copy the working canvas to the best-frame canvas, replacing any previous best. */
  promoteWorkingToBest: () => void;
  storeBestFrame: (video: HTMLVideoElement) => void;
  hasStoredBestFrame: () => boolean;
  storedBestFrameToBlob: () => Promise<Blob>;
  resetStoredBestFrame: () => void;
}

export async function openUserFacingCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraAccessError('In-browser camera capture is not supported in this browser.');
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' } },
      audio: false,
    });
  } catch (error) {
    throw new CameraAccessError(describeCameraError(error), { cause: error });
  }
}

export async function waitForVideoReady(
  video: HTMLVideoElement,
  errorMessage = 'Failed to start the camera preview.',
): Promise<void> {
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
      reject(new Error(errorMessage));
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

export function resumeVideoPlayback(video: HTMLVideoElement) {
  void video.play().catch(() => {
    // Ignore resume failures here; startup paths already surface preview errors loudly.
  });
}

export function createReusableFrameCapture(): ReusableFrameCapture {
  const workingCanvas = document.createElement('canvas');
  const bestFrameCanvas = document.createElement('canvas');
  let hasStoredBestFrame = false;

  const getContext = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to initialize camera capture.');
    }
    return context;
  };

  const drawFrame = (video: HTMLVideoElement, canvas: HTMLCanvasElement) => {
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('Camera preview is not ready yet.');
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    getContext(canvas).drawImage(video, 0, 0, canvas.width, canvas.height);
  };

  return {
    async captureBlob(video) {
      drawFrame(video, workingCanvas);
      return canvasToBlob(workingCanvas);
    },
    captureWorkingFrame(video) {
      drawFrame(video, workingCanvas);
    },
    promoteWorkingToBest() {
      if (!workingCanvas.width || !workingCanvas.height) {
        throw new Error('No working frame to promote.');
      }
      bestFrameCanvas.width = workingCanvas.width;
      bestFrameCanvas.height = workingCanvas.height;
      getContext(bestFrameCanvas).drawImage(workingCanvas, 0, 0);
      hasStoredBestFrame = true;
    },
    storeBestFrame(video) {
      drawFrame(video, bestFrameCanvas);
      hasStoredBestFrame = true;
    },
    hasStoredBestFrame() {
      return hasStoredBestFrame;
    },
    async storedBestFrameToBlob() {
      if (!hasStoredBestFrame) {
        throw new Error('No best frame is available.');
      }
      return canvasToBlob(bestFrameCanvas);
    },
    resetStoredBestFrame() {
      hasStoredBestFrame = false;
      bestFrameCanvas.width = 0;
      bestFrameCanvas.height = 0;
    },
  };
}

export function captureFromFileInput(): Promise<Blob | null> {
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

export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load captured image'));
    };

    image.src = url;
  });
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

export function describeCameraError(error: unknown): string {
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

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
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
