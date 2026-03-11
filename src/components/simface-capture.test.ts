import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const faceDetectionMocks = vi.hoisted(() => ({
  assessFaceQuality: vi.fn(),
  assessFaceQualityForVideo: vi.fn(),
  getVideoDetector: vi.fn(),
}));

vi.mock('../services/face-detection.js', () => faceDetectionMocks);

import { SimFaceCapture } from './simface-capture.js';
import type { FaceQualityResult } from '../types/index.js';

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
    window.Image = createMockImageConstructor();
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
    window.Image = originalImage;
    setMediaDevices(originalMediaDevices);
  });

  it('dispatches simface-cancelled when the cancel button is clicked during capture', async () => {
    const stop = vi.fn();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      }),
    } as unknown as MediaDevices);
    faceDetectionMocks.getVideoDetector.mockRejectedValue(new Error('unsupported'));

    const element = document.createElement('simface-capture') as SimFaceCapture;
    element.embedded = true;
    const cancelledListener = vi.fn();
    element.addEventListener('simface-cancelled', cancelledListener);
    document.body.appendChild(element);
    await element.updateComplete;

    element.active = true;
    await element.updateComplete;
    await flushMicrotasks(10);

    const video = element.shadowRoot?.querySelector('#embedded-video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    if (video) {
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
      video.dispatchEvent(new Event('loadedmetadata'));
      await flushMicrotasks(10);
    }

    const cancelButton = element.shadowRoot?.querySelector('[data-simface-action="cancel"]') as HTMLButtonElement | null;
    expect(cancelButton).not.toBeNull();
    cancelButton?.click();
    await flushMicrotasks();

    expect(cancelledListener).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });

  it('shows take photo button only in manual mode', async () => {
    const stop = vi.fn();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      }),
    } as unknown as MediaDevices);

    // First test: auto mode — no capture button
    faceDetectionMocks.getVideoDetector.mockResolvedValue({});
    faceDetectionMocks.assessFaceQualityForVideo.mockResolvedValue(createQualityResult());

    const element = document.createElement('simface-capture') as SimFaceCapture;
    element.embedded = true;
    document.body.appendChild(element);
    await element.updateComplete;

    element.active = true;
    await element.updateComplete;
    await flushMicrotasks(10);

    const video = element.shadowRoot?.querySelector('#embedded-video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    if (video) {
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
      video.dispatchEvent(new Event('loadedmetadata'));
      await flushMicrotasks(10);
      await element.updateComplete;
    }

    const captureButton = element.shadowRoot?.querySelector('[data-simface-action="capture"]') as HTMLButtonElement | null;
    expect(captureButton).toBeNull();

    // Cleanup for second test
    element.active = false;
    await element.updateComplete;
    await flushMicrotasks();
    element.remove();

    // Second test: manual mode — capture button visible
    faceDetectionMocks.getVideoDetector.mockReset();
    faceDetectionMocks.getVideoDetector.mockRejectedValue(new Error('unsupported'));

    const element2 = document.createElement('simface-capture') as SimFaceCapture;
    element2.embedded = true;
    document.body.appendChild(element2);
    await element2.updateComplete;

    element2.active = true;
    await element2.updateComplete;
    await flushMicrotasks(10);

    const video2 = element2.shadowRoot?.querySelector('#embedded-video') as HTMLVideoElement | null;
    expect(video2).not.toBeNull();
    if (video2) {
      Object.defineProperty(video2, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video2, 'videoHeight', { configurable: true, value: 480 });
      video2.dispatchEvent(new Event('loadedmetadata'));
      await flushMicrotasks(10);
      await element2.updateComplete;
    }

    const captureButton2 = element2.shadowRoot?.querySelector('[data-simface-action="capture"]') as HTMLButtonElement | null;
    expect(captureButton2).not.toBeNull();
    expect(captureButton2?.textContent).toBe('Take photo');
  });

  it('renders custom idle feedback before capture starts', async () => {
    const element = document.createElement('simface-capture') as SimFaceCapture;
    element.embedded = true;
    element.label = 'Choose an action.';
    element.idleFeedbackLabel = 'Start a flow to see guidance.';
    document.body.appendChild(element);
    await element.updateComplete;

    const text = element.shadowRoot?.textContent ?? '';
    expect(text).toContain('Choose an action.');
    expect(text).toContain('Start a flow to see guidance.');
  });

  it('renders custom action labels in manual, preview, and error states', async () => {
    const stop = vi.fn();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      }),
    } as unknown as MediaDevices);
    faceDetectionMocks.getVideoDetector.mockRejectedValue(new Error('unsupported'));
    faceDetectionMocks.assessFaceQuality.mockResolvedValue(createQualityResult());

    const element = document.createElement('simface-capture') as SimFaceCapture;
    element.embedded = true;
    element.captureLabel = 'Snap photo';
    element.retakeLabel = 'Use camera again';
    element.confirmLabel = 'Submit photo';
    element.retryLabel = 'Restart capture';
    document.body.appendChild(element);
    await element.updateComplete;

    element.active = true;
    await element.updateComplete;
    await flushMicrotasks(10);

    const video = element.shadowRoot?.querySelector('#embedded-video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    if (!video) {
      throw new Error('Embedded video was not rendered.');
    }

    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await flushMicrotasks(10);
    await element.updateComplete;

    const captureButton = element.shadowRoot?.querySelector('[data-simface-action="capture"]') as HTMLButtonElement | null;
    expect(captureButton?.textContent).toBe('Snap photo');
    captureButton?.click();
    await flushMicrotasks(10);
    await element.updateComplete;

    const retakeButton = element.shadowRoot?.querySelector('[data-simface-action="retake"]') as HTMLButtonElement | null;
    const confirmButton = element.shadowRoot?.querySelector('[data-simface-action="confirm"]') as HTMLButtonElement | null;
    expect(retakeButton?.textContent).toBe('Use camera again');
    expect(confirmButton?.textContent).toBe('Submit photo');

    // Force error state by restarting capture with camera unavailable
    element.active = false;
    await element.updateComplete;
    await flushMicrotasks(10);

    setMediaDevices({
      getUserMedia: vi.fn().mockRejectedValue(new Error('camera unavailable')),
    } as unknown as MediaDevices);
    element.allowMediaPickerFallback = false;
    element.active = true;
    await element.updateComplete;
    await flushMicrotasks(10);

    const retryButton = element.shadowRoot?.querySelector('[data-simface-action="retry"]') as HTMLButtonElement | null;
    expect(retryButton?.textContent).toBe('Restart capture');
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
      .find((button) => button.textContent?.includes('Accept')) as HTMLButtonElement | undefined;

    expect(confirmButton).toBeDefined();
    expect(element.shadowRoot?.textContent).toContain('Best frame captured. Review and confirm this photo.');
    confirmButton?.click();
    await flushMicrotasks();

    expect(capturedListener).toHaveBeenCalledTimes(1);
    expect(capturedListener.mock.calls[0][0].detail.imageBlob).toBeInstanceOf(Blob);
    expect(stop).toHaveBeenCalled();
  });

  it('declares color-scheme light to prevent iOS dark-mode flicker', () => {
    // Lit CSSResult.toString() returns the raw CSS text
    const cssText = String(SimFaceCapture.styles);
    expect(cssText).toContain('color-scheme: light');
  });

  it('updates --capture-progress on the host element during auto-capture countdown', async () => {
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
      message: 'Hold still.',
    }));
    faceDetectionMocks.getVideoDetector.mockResolvedValue({});

    const element = document.createElement('simface-capture') as SimFaceCapture;
    element.embedded = true;
    document.body.appendChild(element);
    await element.updateComplete;

    element.active = true;
    await element.updateComplete;
    await flushMicrotasks();

    const video = element.shadowRoot?.querySelector('#embedded-video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    if (!video) throw new Error('Video not rendered.');

    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    video.dispatchEvent(new Event('loadedmetadata'));
    await flushMicrotasks();

    // First frame starts the countdown at t=200
    const callback1 = animationFrames.shift();
    expect(callback1).toBeDefined();
    callback1!(200);
    await flushMicrotasks();

    // Second frame at t=2700 should have meaningful progress
    const callback2 = animationFrames.shift();
    expect(callback2).toBeDefined();
    callback2!(2700);
    await flushMicrotasks();

    const progress = element.style.getPropertyValue('--capture-progress');
    expect(Number(progress)).toBeGreaterThan(0);

    // The guide-overlay div should NOT carry an inline --capture-progress style
    const overlay = element.shadowRoot?.querySelector('.guide-overlay') as HTMLElement | null;
    expect(overlay?.style.getPropertyValue('--capture-progress')).toBe('');
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
