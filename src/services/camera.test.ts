import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const faceDetectionMocks = vi.hoisted(() => ({
  assessFaceQuality: vi.fn(),
  assessFaceQualityForVideo: vi.fn(),
  getVideoDetector: vi.fn(),
}));

vi.mock('../services/face-detection.js', () => faceDetectionMocks);

import { blobToDataURL, captureFromCamera } from '../services/camera.js';
import type { FaceQualityResult } from '../types/index.js';

const originalUserAgent = navigator.userAgent;
const originalMediaDevices = navigator.mediaDevices;
const originalPlay = HTMLMediaElement.prototype.play;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;
const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;
const originalSetTimeout = window.setTimeout;
const originalClearTimeout = window.clearTimeout;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalImage = window.Image;

describe('camera service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    setUserAgent(originalUserAgent);
    setMediaDevices(originalMediaDevices);
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D);
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob(['image data'], { type: 'image/jpeg' }));
    });
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    window.Image = createMockImageConstructor();
    faceDetectionMocks.assessFaceQuality.mockReset();
    faceDetectionMocks.assessFaceQualityForVideo.mockReset();
    faceDetectionMocks.getVideoDetector.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    window.Image = originalImage;
  });

  describe('captureFromCamera', () => {
    it('counts down from the first good frame and confirms the best auto-captured popup frame', async () => {
      setUserAgent('Mozilla/5.0 Chrome/122.0 Safari/537.36');

      const stop = vi.fn();
      const getUserMedia = vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      } as unknown as MediaStream);

      setMediaDevices({ getUserMedia } as MediaDevices);
      faceDetectionMocks.getVideoDetector.mockResolvedValue({});
      faceDetectionMocks.assessFaceQualityForVideo
        .mockResolvedValueOnce(createQualityResult({
          captureScore: 0.78,
          message: 'Face looks good.',
        }))
        .mockResolvedValueOnce(createQualityResult({
          captureScore: 0.94,
          message: 'Face looks great.',
        }))
        .mockResolvedValueOnce(createQualityResult({
          captureScore: 0.12,
          passesQualityChecks: false,
          feedback: 'move-left',
          message: 'Move a little left.',
        }));

      const secondBlob = new Blob(['second auto frame'], { type: 'image/jpeg' });
      const toBlob = vi.fn<Parameters<HTMLCanvasElement['toBlob']>, ReturnType<HTMLCanvasElement['toBlob']>>((callback: BlobCallback) => {
        callback(secondBlob);
      });
      HTMLCanvasElement.prototype.toBlob = toBlob;

      const animationFrames: FrameRequestCallback[] = [];
      window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      });
      window.cancelAnimationFrame = vi.fn();
      window.setTimeout = vi.fn((callback: TimerHandler) => {
        if (typeof callback === 'function') {
          callback();
        }
        return 1 as unknown as number;
      }) as typeof window.setTimeout;
      window.clearTimeout = vi.fn() as typeof window.clearTimeout;

      const capturePromise = captureFromCamera();
      await flushMicrotasks();

      const video = document.querySelector('video') as HTMLVideoElement | null;
      expect(video).not.toBeNull();
      if (!video) {
        throw new Error('Video element was not rendered.');
      }

      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
      video.dispatchEvent(new Event('loadedmetadata'));
      await flushMicrotasks();

      for (const timestamp of [200, 2200, 5400]) {
        const callback = animationFrames.shift();
        if (!callback) {
          throw new Error('Expected an animation frame callback.');
        }

        callback(timestamp);
        await flushMicrotasks();
      }

      const confirmButton = document.querySelector('[data-simface-action="confirm"]') as HTMLButtonElement | null;
      expect(confirmButton).not.toBeNull();
      expect(document.body.textContent).toContain('Best frame captured. Review and confirm this photo.');
      confirmButton?.dispatchEvent(new MouseEvent('click'));

      const result = await capturePromise;

      expect(result).toBe(secondBlob);
      expect(faceDetectionMocks.assessFaceQualityForVideo).toHaveBeenCalledTimes(3);
      expect(toBlob).toHaveBeenCalledTimes(1);
      expect(getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: { ideal: 'user' } },
        audio: false,
      });
      expect(stop).toHaveBeenCalled();
    });

    it('falls back to manual capture when realtime guidance is unavailable', async () => {
      setUserAgent('Mozilla/5.0 Chrome/122.0 Safari/537.36');

      const stop = vi.fn();
      const getUserMedia = vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      } as unknown as MediaStream);

      setMediaDevices({ getUserMedia } as MediaDevices);
      faceDetectionMocks.getVideoDetector.mockRejectedValue(new Error('unsupported'));
      faceDetectionMocks.assessFaceQuality.mockResolvedValue(createQualityResult());

      const capturePromise = captureFromCamera();
      await flushMicrotasks();

      const video = document.querySelector('video') as HTMLVideoElement | null;
      expect(video).not.toBeNull();
      if (!video) {
        throw new Error('Video element was not rendered.');
      }

      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
      video.dispatchEvent(new Event('loadedmetadata'));
      await flushMicrotasks(10);

      const captureButton = document.querySelector('[data-simface-action="capture"]') as HTMLButtonElement | null;
      expect(captureButton).not.toBeNull();
      expect(captureButton?.style.display).toBe('inline-flex');
      expect(captureButton?.disabled).toBe(false);

      captureButton?.dispatchEvent(new MouseEvent('click'));
      await flushMicrotasks(10);

      const confirmButton = document.querySelector('[data-simface-action="confirm"]') as HTMLButtonElement | null;
      expect(confirmButton).not.toBeNull();
      confirmButton?.dispatchEvent(new MouseEvent('click'));

      const result = await capturePromise;
      expect(result).toBeInstanceOf(Blob);
      expect(faceDetectionMocks.assessFaceQualityForVideo).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalled();
    });

    it('retake replaces the previous preview and confirms the new capture', async () => {
      setUserAgent('Mozilla/5.0 Chrome/122.0 Safari/537.36');

      const stop = vi.fn();
      const getUserMedia = vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      } as unknown as MediaStream);

      setMediaDevices({ getUserMedia } as MediaDevices);
      faceDetectionMocks.getVideoDetector.mockRejectedValue(new Error('unsupported'));
      faceDetectionMocks.assessFaceQuality.mockResolvedValue(createQualityResult());

      const firstBlob = new Blob(['first image'], { type: 'image/jpeg' });
      const secondBlob = new Blob(['second image'], { type: 'image/jpeg' });
      const toBlob = vi.fn<Parameters<HTMLCanvasElement['toBlob']>, ReturnType<HTMLCanvasElement['toBlob']>>((callback: BlobCallback) => {
        callback(toBlob.mock.calls.length === 1 ? firstBlob : secondBlob);
      });
      HTMLCanvasElement.prototype.toBlob = toBlob;

      const capturePromise = captureFromCamera();
      await flushMicrotasks();

      const video = document.querySelector('video') as HTMLVideoElement | null;
      expect(video).not.toBeNull();
      if (!video) {
        throw new Error('Video element was not rendered.');
      }

      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
      video.dispatchEvent(new Event('loadedmetadata'));
      await flushMicrotasks(10);

      const captureButton = document.querySelector('[data-simface-action="capture"]') as HTMLButtonElement | null;
      expect(captureButton).not.toBeNull();
      expect(captureButton?.disabled).toBe(false);

      captureButton?.dispatchEvent(new MouseEvent('click'));
      await flushMicrotasks(10);

      const previewImage = document.querySelector('img[alt="Captured face preview"]') as HTMLImageElement | null;
      expect(previewImage).not.toBeNull();
      expect(document.querySelector('video')).toBe(video);

      const retakeButton = document.querySelector('[data-simface-action="retake"]') as HTMLButtonElement | null;
      expect(retakeButton).not.toBeNull();
      retakeButton?.dispatchEvent(new MouseEvent('click'));
      await flushMicrotasks(10);

      expect(document.querySelector('img[alt="Captured face preview"]')).toBeNull();
      expect(document.querySelector('video')).toBe(video);

      captureButton?.dispatchEvent(new MouseEvent('click'));
      await flushMicrotasks(10);

      const confirmButton = document.querySelector('[data-simface-action="confirm"]') as HTMLButtonElement | null;
      expect(confirmButton).not.toBeNull();
      confirmButton?.dispatchEvent(new MouseEvent('click'));

      const result = await capturePromise;
      expect(result).toBe(secondBlob);
      expect(toBlob).toHaveBeenCalledTimes(2);
      expect(stop).toHaveBeenCalled();
    });

    it('falls back to file input capture in WhatsApp when mediaDevices is unavailable', async () => {
      setUserAgent('Mozilla/5.0 WhatsApp/2.24.0');
      setMediaDevices(undefined);

      const appendSpy = vi.spyOn(document.body, 'appendChild');
      const mockFile = new File(['image data'], 'photo.jpg', { type: 'image/jpeg' });

      appendSpy.mockImplementation((node) => {
        const input = node as HTMLInputElement;
        Object.defineProperty(input, 'files', { value: [mockFile] });
        setTimeout(() => input.dispatchEvent(new Event('change')), 0);
        return node;
      });

      const result = await captureFromCamera();
      expect(result).toBe(mockFile);

      const input = appendSpy.mock.calls[0][0] as HTMLInputElement;
      expect(input.type).toBe('file');
      expect(input.accept).toBe('image/*');
      expect(input.capture).toBe('user');
    });

    it('skips auto-capture probe and uses manual camera in WhatsApp when mediaDevices is available', async () => {
      setUserAgent('Mozilla/5.0 WhatsApp/2.24.0');

      const stop = vi.fn();
      const getUserMedia = vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      } as unknown as MediaStream);

      setMediaDevices({ getUserMedia } as MediaDevices);
      faceDetectionMocks.getVideoDetector.mockResolvedValue({});
      faceDetectionMocks.assessFaceQuality.mockResolvedValue(createQualityResult());

      const capturePromise = captureFromCamera();
      await flushMicrotasks();

      const video = document.querySelector('video') as HTMLVideoElement | null;
      expect(video).not.toBeNull();
      if (!video) {
        throw new Error('Video element was not rendered.');
      }

      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
      video.dispatchEvent(new Event('loadedmetadata'));
      await flushMicrotasks(10);

      // Auto-capture probe must not have been called for WhatsApp UA
      expect(faceDetectionMocks.getVideoDetector).not.toHaveBeenCalled();

      // Manual capture button should be visible (not auto-capture countdown)
      const captureButton = document.querySelector('[data-simface-action="capture"]') as HTMLButtonElement | null;
      expect(captureButton).not.toBeNull();
      expect(captureButton?.style.display).toBe('inline-flex');

      captureButton?.dispatchEvent(new MouseEvent('click'));
      await flushMicrotasks(10);

      const confirmButton = document.querySelector('[data-simface-action="confirm"]') as HTMLButtonElement | null;
      expect(confirmButton).not.toBeNull();
      confirmButton?.dispatchEvent(new MouseEvent('click'));

      const result = await capturePromise;
      expect(result).toBeInstanceOf(Blob);
      expect(faceDetectionMocks.assessFaceQuality).toHaveBeenCalled();
      expect(faceDetectionMocks.assessFaceQualityForVideo).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalled();
    });

    it('falls back to file input capture when camera capture is unavailable outside WhatsApp', async () => {
      setUserAgent('Mozilla/5.0 Chrome/122.0 Safari/537.36');
      setMediaDevices(undefined);
      const appendSpy = vi.spyOn(document.body, 'appendChild');
      const mockFile = new File(['image data'], 'photo.jpg', { type: 'image/jpeg' });

      appendSpy.mockImplementation((node) => {
        const input = node as HTMLInputElement;
        Object.defineProperty(input, 'files', { value: [mockFile] });
        setTimeout(() => input.dispatchEvent(new Event('change')), 0);
        return node;
      });

      await expect(captureFromCamera()).resolves.toBe(mockFile);
    });

    it('does not open the camera stream if the capture UI fails to open', async () => {
      setUserAgent('Mozilla/5.0 Chrome/122.0 Safari/537.36');

      const stop = vi.fn();
      const getUserMedia = vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      } as unknown as MediaStream);

      setMediaDevices({ getUserMedia } as MediaDevices);
      faceDetectionMocks.getVideoDetector.mockResolvedValue({});
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
        throw new Error('append failed');
      });

      await expect(captureFromCamera()).rejects.toThrow('append failed');
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();
    });
  });

  describe('blobToDataURL', () => {
    it('converts a blob to a data URL', async () => {
      const blob = new Blob(['hello'], { type: 'text/plain' });
      const url = await blobToDataURL(blob);
      expect(url).toMatch(/^data:/);
    });
  });
});

function createQualityResult(
  overrides: Partial<FaceQualityResult> = {},
): FaceQualityResult {
  return {
    hasFace: true,
    faceCount: 1,
    confidence: 0.95,
    captureScore: 0.92,
    isCentered: true,
    passesQualityChecks: true,
    feedback: 'good',
    message: 'Face looks good.',
    ...overrides,
  };
}

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value,
  });
}

function setMediaDevices(value: MediaDevices | undefined) {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value,
  });
}

async function flushMicrotasks(iterations = 5) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function createMockImageConstructor(): typeof Image {
  return class MockImage {
    onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null = null;
    onerror: ((this: GlobalEventHandlers, ev: Event | string) => unknown) | null = null;
    naturalWidth = 640;
    naturalHeight = 480;

    set src(_value: string) {
      queueMicrotask(() => {
        this.onload?.call(this as unknown as GlobalEventHandlers, new Event('load'));
      });
    }
  } as unknown as typeof Image;
}
