import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cameraMocks = vi.hoisted(() => ({
  blobToImage: vi.fn(),
  captureFromCamera: vi.fn(),
}));

const faceDetectionMocks = vi.hoisted(() => ({
  assessFaceQuality: vi.fn(),
  assessFaceQualityForVideo: vi.fn(),
  getVideoDetector: vi.fn(),
}));

vi.mock('../services/camera.js', () => cameraMocks);
vi.mock('../services/face-detection.js', () => faceDetectionMocks);

import './simface-capture.js';
import type { FaceQualityResult } from '../types/index.js';
import type { SimFaceCapture } from './simface-capture.js';

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

describe('<simface-capture>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
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
    cameraMocks.blobToImage.mockReset();
    cameraMocks.captureFromCamera.mockReset();
    faceDetectionMocks.assessFaceQuality.mockReset();
    faceDetectionMocks.assessFaceQualityForVideo.mockReset();
    faceDetectionMocks.getVideoDetector.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    HTMLMediaElement.prototype.play = originalPlay;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    setMediaDevices(originalMediaDevices);
  });

  it('dispatches simface-cancelled when popup capture returns null', async () => {
    cameraMocks.captureFromCamera.mockResolvedValue(null);

    const element = document.createElement('simface-capture') as SimFaceCapture;
    const cancelledListener = vi.fn();
    element.addEventListener('simface-cancelled', cancelledListener);
    document.body.appendChild(element);
    await element.updateComplete;

    const button = element.shadowRoot?.querySelector('.btn-primary') as HTMLButtonElement | null;
    button?.click();
    await flushMicrotasks();

    expect(cancelledListener).toHaveBeenCalledTimes(1);
  });

  it('captures inline and emits the confirmed blob in embedded mode', async () => {
    const stop = vi.fn();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      }),
    } as unknown as MediaDevices);

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

    faceDetectionMocks.assessFaceQualityForVideo.mockResolvedValue(createQualityResult({
      passesQualityChecks: true,
      message: 'Hold still. Capturing automatically...',
    }));
    faceDetectionMocks.getVideoDetector.mockResolvedValue({});
    cameraMocks.blobToImage.mockResolvedValue({ naturalWidth: 640, naturalHeight: 480 });
    faceDetectionMocks.assessFaceQuality.mockResolvedValue(createQualityResult());

    const element = document.createElement('simface-capture') as SimFaceCapture;
    element.embedded = true;
    const capturedListener = vi.fn();
    element.addEventListener('simface-captured', capturedListener);
    document.body.appendChild(element);
    await element.updateComplete;

    element.active = true;
    await element.updateComplete;
    await flushMicrotasks();

    const video = element.shadowRoot?.querySelector('#embedded-video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    if (!video) {
      throw new Error('Embedded video was not rendered.');
    }

    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await flushMicrotasks();

      for (const timestamp of [200, 5400]) {
        const callback = animationFrames.shift();
        if (!callback) {
          throw new Error('Expected an animation frame callback.');
      }

      callback(timestamp);
      await flushMicrotasks();
    }

      const confirmButton = [...(element.shadowRoot?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.includes('Use this capture')) as HTMLButtonElement | undefined;

    expect(confirmButton).toBeDefined();
    expect(element.shadowRoot?.textContent).toContain('Best frame captured. Review and confirm this photo.');
    confirmButton?.click();
    await flushMicrotasks();

    expect(capturedListener).toHaveBeenCalledTimes(1);
    expect(capturedListener.mock.calls[0][0].detail.imageBlob).toBeInstanceOf(Blob);
    expect(stop).toHaveBeenCalled();
  });
});

function setMediaDevices(value: MediaDevices | undefined) {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value,
  });
}

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

async function flushMicrotasks(iterations = 5) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}
