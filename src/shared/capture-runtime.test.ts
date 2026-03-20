import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CameraAccessError,
  blobToDataURL,
  blobToImage,
  createReusableFrameCapture,
  describeCameraError,
  openUserFacingCameraStream,
  resumeVideoPlayback,
  waitForVideoReady,
} from './capture-runtime.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVideo(overrides: { videoWidth?: number; videoHeight?: number; readyState?: number } = {}) {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { value: overrides.videoWidth ?? 640, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: overrides.videoHeight ?? 480, configurable: true });
  if (overrides.readyState !== undefined) {
    Object.defineProperty(video, 'readyState', { value: overrides.readyState, configurable: true });
  }
  vi.spyOn(video, 'play').mockResolvedValue();
  return video;
}

function mockCanvasContext() {
  const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    cb(new Blob(['test'], { type: 'image/jpeg' }));
  });
  return ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CameraAccessError', () => {
  it('is an instance of Error', () => {
    const err = new CameraAccessError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CameraAccessError);
  });

  it('has name "CameraAccessError"', () => {
    expect(new CameraAccessError('x').name).toBe('CameraAccessError');
  });

  it('stores the message', () => {
    expect(new CameraAccessError('oops').message).toBe('oops');
  });

  it('attaches cause when provided', () => {
    const cause = new TypeError('inner');
    const err = new CameraAccessError('wrap', { cause });
    expect(err.cause).toBe(cause);
  });

  it('has no cause property when not provided', () => {
    const err = new CameraAccessError('plain');
    expect('cause' in err).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('describeCameraError', () => {
  it('handles NotAllowedError', () => {
    const err = new DOMException('denied', 'NotAllowedError');
    expect(describeCameraError(err)).toBe('Camera access was denied. Allow camera access and try again.');
  });

  it('handles SecurityError', () => {
    const err = new DOMException('sec', 'SecurityError');
    expect(describeCameraError(err)).toBe('Camera access was denied. Allow camera access and try again.');
  });

  it('handles NotFoundError', () => {
    const err = new DOMException('nf', 'NotFoundError');
    expect(describeCameraError(err)).toBe('No camera was found on this device.');
  });

  it('handles NotReadableError', () => {
    const err = new DOMException('busy', 'NotReadableError');
    expect(describeCameraError(err)).toBe('The camera is already in use by another application.');
  });

  it('handles unknown DOMException with message', () => {
    const err = new DOMException('something weird', 'AbortError');
    expect(describeCameraError(err)).toBe('something weird');
  });

  it('handles unknown DOMException with empty message', () => {
    const err = new DOMException('', 'UnknownError');
    expect(describeCameraError(err)).toBe('Failed to access the camera.');
  });

  it('handles generic Error', () => {
    expect(describeCameraError(new Error('generic'))).toBe('generic');
  });

  it('handles non-Error value', () => {
    expect(describeCameraError('string')).toBe('Failed to access the camera.');
    expect(describeCameraError(42)).toBe('Failed to access the camera.');
    expect(describeCameraError(null)).toBe('Failed to access the camera.');
  });
});

// ---------------------------------------------------------------------------

describe('openUserFacingCameraStream', () => {
  it('returns a MediaStream on success', async () => {
    const fakeStream = {} as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
      configurable: true,
    });

    const stream = await openUserFacingCameraStream();
    expect(stream).toBe(fakeStream);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'user' } },
      audio: false,
    });
  });

  it('throws CameraAccessError when getUserMedia is missing', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      configurable: true,
    });

    await expect(openUserFacingCameraStream()).rejects.toThrow(CameraAccessError);
    await expect(openUserFacingCameraStream()).rejects.toThrow(
      'In-browser camera capture is not supported in this browser.',
    );
  });

  it('throws CameraAccessError when mediaDevices is undefined', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
    });

    await expect(openUserFacingCameraStream()).rejects.toThrow(CameraAccessError);
  });

  it('wraps DOMException from getUserMedia in CameraAccessError', async () => {
    const domErr = new DOMException('denied', 'NotAllowedError');
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockRejectedValue(domErr) },
      configurable: true,
    });

    try {
      await openUserFacingCameraStream();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CameraAccessError);
      expect((err as CameraAccessError).cause).toBe(domErr);
      expect((err as CameraAccessError).message).toBe(
        'Camera access was denied. Allow camera access and try again.',
      );
    }
  });
});

// ---------------------------------------------------------------------------

describe('waitForVideoReady', () => {
  it('resolves immediately when video is already ready', async () => {
    const video = makeVideo({ readyState: HTMLMediaElement.HAVE_CURRENT_DATA });

    await waitForVideoReady(video);
    expect(video.play).toHaveBeenCalled();
  });

  it('resolves when loadedmetadata fires', async () => {
    const video = makeVideo({ readyState: 0 });

    const promise = waitForVideoReady(video);
    video.dispatchEvent(new Event('loadedmetadata'));
    await promise;

    expect(video.play).toHaveBeenCalled();
  });

  it('rejects with default message when error fires', async () => {
    const video = makeVideo({ readyState: 0 });

    const promise = waitForVideoReady(video);
    video.dispatchEvent(new Event('error'));

    await expect(promise).rejects.toThrow('Failed to start the camera preview.');
  });

  it('rejects with custom error message', async () => {
    const video = makeVideo({ readyState: 0 });

    const promise = waitForVideoReady(video, 'Custom error');
    video.dispatchEvent(new Event('error'));

    await expect(promise).rejects.toThrow('Custom error');
  });
});

// ---------------------------------------------------------------------------

describe('resumeVideoPlayback', () => {
  it('calls video.play()', () => {
    const video = makeVideo();
    resumeVideoPlayback(video);
    expect(video.play).toHaveBeenCalled();
  });

  it('silently catches play rejection', () => {
    const video = makeVideo();
    (video.play as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('AbortError'));

    // Should not throw
    expect(() => resumeVideoPlayback(video)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('blobToDataURL', () => {
  const OriginalFileReader = globalThis.FileReader;

  afterEach(() => {
    globalThis.FileReader = OriginalFileReader;
  });

  it('resolves with a data URL', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const result = await blobToDataURL(blob);
    expect(result).toMatch(/^data:/);
  });

  it('rejects when FileReader errors', async () => {
    globalThis.FileReader = class MockFileReader {
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      result: string | ArrayBuffer | null = null;

      readAsDataURL() {
        // Simulate async error
        queueMicrotask(() => this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>));
      }
    } as unknown as typeof FileReader;

    await expect(blobToDataURL(new Blob(['x']))).rejects.toThrow('Failed to read image');
  });
});

// ---------------------------------------------------------------------------

describe('blobToImage', () => {
  const OriginalImage = globalThis.Image;
  const OriginalCreateObjectURL = globalThis.URL.createObjectURL;
  const OriginalRevokeObjectURL = globalThis.URL.revokeObjectURL;

  afterEach(() => {
    globalThis.Image = OriginalImage;
    globalThis.URL.createObjectURL = OriginalCreateObjectURL;
    globalThis.URL.revokeObjectURL = OriginalRevokeObjectURL;
  });

  it('resolves with an HTMLImageElement on success', async () => {
    const revokeStub = vi.fn();
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    globalThis.URL.revokeObjectURL = revokeStub;

    // Mock Image so that setting `src` triggers `onload` asynchronously
    globalThis.Image = class extends OriginalImage {
      constructor() {
        super();
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const instance = this;
        Object.defineProperty(this, 'src', {
          set() {
            queueMicrotask(() => instance.onload?.(new Event('load') as Event));
          },
          configurable: true,
        });
      }
    } as typeof Image;

    const blob = new Blob(['img'], { type: 'image/png' });
    const result = await blobToImage(blob);

    expect(result).toBeInstanceOf(HTMLImageElement);
    expect(revokeStub).toHaveBeenCalledWith('blob:fake-url');
  });

  it('rejects on image error', async () => {
    const revokeStub = vi.fn();
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    globalThis.URL.revokeObjectURL = revokeStub;

    globalThis.Image = class extends OriginalImage {
      constructor() {
        super();
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const instance = this;
        Object.defineProperty(this, 'src', {
          set() {
            queueMicrotask(() => instance.onerror?.(new Event('error') as Event));
          },
          configurable: true,
        });
      }
    } as typeof Image;

    const blob = new Blob(['bad'], { type: 'image/png' });
    await expect(blobToImage(blob)).rejects.toThrow('Failed to load captured image');
    expect(revokeStub).toHaveBeenCalledWith('blob:fake-url');
  });
});

// ---------------------------------------------------------------------------

describe('createReusableFrameCapture', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = mockCanvasContext();
  });

  it('captureWorkingFrame draws video to working canvas', () => {
    const capture = createReusableFrameCapture();
    const video = makeVideo();

    capture.captureWorkingFrame(video);
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('captureWorkingFrame throws when video has no dimensions', () => {
    const capture = createReusableFrameCapture();
    const video = makeVideo({ videoWidth: 0, videoHeight: 0 });

    expect(() => capture.captureWorkingFrame(video)).toThrow('Camera preview is not ready yet.');
  });

  it('captureBlob draws and returns a blob', async () => {
    const capture = createReusableFrameCapture();
    const video = makeVideo();

    const blob = await capture.captureBlob(video);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('promoteWorkingToBest copies working canvas to best canvas', () => {
    const capture = createReusableFrameCapture();
    const video = makeVideo();

    capture.captureWorkingFrame(video);
    capture.promoteWorkingToBest();
    expect(capture.hasStoredBestFrame()).toBe(true);
  });

  it('promoteWorkingToBest throws when working canvas is empty', () => {
    // jsdom defaults canvas to 300×150; intercept createElement to produce 0×0 canvases
    const origCreateElement = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(((tag: string, options?: ElementCreationOptions) => {
        const el = origCreateElement(tag, options);
        if (tag === 'canvas') {
          (el as HTMLCanvasElement).width = 0;
          (el as HTMLCanvasElement).height = 0;
        }
        return el;
      }) as typeof document.createElement);

    const capture = createReusableFrameCapture();
    createSpy.mockRestore();

    expect(() => capture.promoteWorkingToBest()).toThrow('No working frame to promote.');
  });

  it('storeBestFrame draws video directly to best canvas', () => {
    const capture = createReusableFrameCapture();
    const video = makeVideo();

    capture.storeBestFrame(video);
    expect(capture.hasStoredBestFrame()).toBe(true);
  });

  it('hasStoredBestFrame returns false initially', () => {
    const capture = createReusableFrameCapture();
    expect(capture.hasStoredBestFrame()).toBe(false);
  });

  it('storedBestFrameToBlob throws when no best frame stored', async () => {
    const capture = createReusableFrameCapture();
    await expect(capture.storedBestFrameToBlob()).rejects.toThrow('No best frame is available.');
  });

  it('storedBestFrameToBlob returns blob when best frame exists', async () => {
    const capture = createReusableFrameCapture();
    const video = makeVideo();

    capture.storeBestFrame(video);
    const blob = await capture.storedBestFrameToBlob();
    expect(blob).toBeInstanceOf(Blob);
  });

  it('resetStoredBestFrame clears the stored best frame', () => {
    const capture = createReusableFrameCapture();
    const video = makeVideo();

    capture.storeBestFrame(video);
    expect(capture.hasStoredBestFrame()).toBe(true);

    capture.resetStoredBestFrame();
    expect(capture.hasStoredBestFrame()).toBe(false);
  });
});
