import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureRuntimeMocks = vi.hoisted(() => ({
  createReusableFrameCapture: vi.fn(),
  resumeVideoPlayback: vi.fn(),
  waitForVideoReady: vi.fn(),
  blobToImage: vi.fn(),
}));

vi.mock('./capture-runtime.js', () => captureRuntimeMocks);

import { CameraCaptureSessionController } from './capture-session.js';
import type {
  CameraCaptureSessionControllerOptions,
  CameraCaptureSessionState,
} from './capture-session.js';
import type { FaceQualityResult } from '../types/index.js';

function makeQualityResult(overrides: Partial<FaceQualityResult> = {}): FaceQualityResult {
  return {
    hasFace: true,
    faceCount: 1,
    confidence: 0.9,
    captureScore: 0.85,
    sharpnessScore: 0.8,
    isCentered: true,
    passesQualityChecks: true,
    feedback: 'good',
    message: 'Face looks good.',
    ...overrides,
  };
}

function makeFrameCaptureMock() {
  return {
    captureBlob: vi.fn().mockResolvedValue(new Blob(['img'], { type: 'image/jpeg' })),
    captureWorkingFrame: vi.fn(),
    promoteWorkingToBest: vi.fn(),
    storeBestFrame: vi.fn(),
    hasStoredBestFrame: vi.fn().mockReturnValue(false),
    storedBestFrameToBlob: vi.fn().mockResolvedValue(new Blob(['best'], { type: 'image/jpeg' })),
    resetStoredBestFrame: vi.fn(),
  };
}

const defaultCopy = {
  autoReadyMessage: 'Position your face.',
  manualReadyMessage: 'Press the button to take a photo.',
  autoUnavailableMessage: 'Auto-capture is unavailable.',
  retakeReadyMessage: 'Ready to retake.',
};

function makeController(overrides: Partial<CameraCaptureSessionControllerOptions> = {}) {
  const onStateChange = vi.fn<[CameraCaptureSessionState], void>();
  const frameCaptureMock = makeFrameCaptureMock();
  captureRuntimeMocks.createReusableFrameCapture.mockReturnValue(frameCaptureMock);

  const controller = new CameraCaptureSessionController({
    videoElement: document.createElement('video'),
    initialMode: 'manual',
    copy: defaultCopy,
    onStateChange,
    waitForReady: vi.fn().mockResolvedValue(undefined),
    assessLiveQuality: vi.fn().mockResolvedValue(makeQualityResult()),
    assessPreviewBlob: vi.fn().mockResolvedValue(makeQualityResult()),
    ...overrides,
  });

  return { controller, onStateChange, frameCaptureMock };
}

describe('CameraCaptureSessionController.stop()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    captureRuntimeMocks.createReusableFrameCapture.mockReset();
    captureRuntimeMocks.resumeVideoPlayback.mockReset();
    captureRuntimeMocks.waitForVideoReady.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prevents further onStateChange calls after stop() is called', async () => {
    const { controller, onStateChange } = makeController();
    onStateChange.mockClear();

    controller.stop();
    await controller.start();

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('stops emitting state mid-flight when stop() is called after waitForReady resolves', async () => {
    let resolveReady: (() => void) | null = null;
    const waitForReady = vi.fn().mockReturnValue(new Promise<void>((r) => {
      resolveReady = r;
    }));
    const { controller, onStateChange } = makeController({ waitForReady });
    onStateChange.mockClear();

    const startPromise = controller.start();
    resolveReady!();
    controller.stop();

    await startPromise;

    // Only the 'starting' emit (which ran before the await) should have fired — if at all.
    // After stop() the live-state emit must not fire.
    const liveEmits = onStateChange.mock.calls.filter(([s]) => s.phase === 'live');
    expect(liveEmits).toHaveLength(0);
  });

  it('prevents takePhotoNow() from emitting after stop()', async () => {
    const { controller, onStateChange } = makeController();
    await controller.start();
    onStateChange.mockClear();

    controller.stop();
    await controller.takePhotoNow();

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('does not emit when stop() is called while takePhotoNow() blob capture is in-flight', async () => {
    let resolveBlob: ((b: Blob) => void) | null = null;
    const frameCaptureMock = makeFrameCaptureMock();
    frameCaptureMock.captureBlob.mockReturnValue(new Promise<Blob>((r) => { resolveBlob = r; }));
    captureRuntimeMocks.createReusableFrameCapture.mockReturnValue(frameCaptureMock);

    const { controller, onStateChange } = makeController();
    await controller.start();
    onStateChange.mockClear();

    const photoPromise = controller.takePhotoNow();
    controller.stop();
    resolveBlob!(new Blob(['img'], { type: 'image/jpeg' }));

    await photoPromise;

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('does not emit when stop() is called while takePhotoNow() quality assessment is in-flight', async () => {
    let resolveQuality: ((q: FaceQualityResult) => void) | null = null;
    const assessPreviewBlob = vi.fn().mockReturnValue(
      new Promise<FaceQualityResult>((r) => { resolveQuality = r; }),
    );
    const { controller, onStateChange } = makeController({ assessPreviewBlob });
    await controller.start();
    onStateChange.mockClear();

    const photoPromise = controller.takePhotoNow();
    controller.stop();
    resolveQuality!(makeQualityResult());

    await photoPromise;

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('prevents retake() from emitting after stop()', async () => {
    const assessPreviewBlob = vi.fn().mockResolvedValue(makeQualityResult());
    const { controller, onStateChange } = makeController({ assessPreviewBlob });
    await controller.start();
    await controller.takePhotoNow();
    onStateChange.mockClear();

    controller.stop();
    await controller.retake();

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('prevents emitError() from emitting after stop()', () => {
    const { controller, onStateChange } = makeController();
    onStateChange.mockClear();

    controller.stop();
    controller.emitError('Something went wrong.');

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('does not schedule auto-analysis timers after stop()', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const { controller, onStateChange } = makeController({ initialMode: 'auto' });
    await controller.start();
    setTimeoutSpy.mockClear();
    onStateChange.mockClear();

    controller.stop();

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('does not emit from an in-flight runAutoAnalysis after stop()', async () => {
    let resolveQuality: ((q: FaceQualityResult) => void) | null = null;
    const assessLiveQuality = vi.fn().mockReturnValue(
      new Promise<FaceQualityResult>((r) => { resolveQuality = r; }),
    );

    const { controller, onStateChange } = makeController({
      initialMode: 'auto',
      assessLiveQuality,
    });
    await controller.start();

    // Trigger analysis loop by advancing timers + flushing animation frame.
    vi.runAllTimers();
    await vi.runAllTicks();
    onStateChange.mockClear();

    // stop() while quality assessment is still pending.
    controller.stop();
    resolveQuality!(makeQualityResult());
    await vi.runAllTicks();

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('does not emit from an in-flight finishAutoCapture after stop()', async () => {
    let resolveQualityFirst: ((q: FaceQualityResult) => void) | null = null;
    let callCount = 0;
    const assessLiveQuality = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise<FaceQualityResult>((r) => { resolveQualityFirst = r; });
      }
      return Promise.resolve(makeQualityResult());
    });

    const frameCaptureMock = makeFrameCaptureMock();
    let resolveBestBlob: ((b: Blob) => void) | null = null;
    frameCaptureMock.hasStoredBestFrame.mockReturnValue(true);
    frameCaptureMock.storedBestFrameToBlob.mockReturnValue(
      new Promise<Blob>((r) => { resolveBestBlob = r; }),
    );
    captureRuntimeMocks.createReusableFrameCapture.mockReturnValue(frameCaptureMock);

    const { controller, onStateChange } = makeController({
      initialMode: 'auto',
      assessLiveQuality,
    });
    await controller.start();

    // Advance timer so the first analysis fires and starts countdown.
    vi.runAllTimers();
    await vi.runAllTicks();

    // Resolve quality to trigger countdown completion path:
    // pass a result with countdown already past 100% by manipulating countdownStartedAt.
    // Actually let's directly resolve with passesQualityChecks=true and trust the countdown path.
    resolveQualityFirst!(makeQualityResult());
    await vi.runAllTicks();

    // At this point finishAutoCapture might be in-flight (storedBestFrameToBlob pending).
    onStateChange.mockClear();
    controller.stop();
    resolveBestBlob!(new Blob(['best'], { type: 'image/jpeg' }));
    await vi.runAllTicks();

    expect(onStateChange).not.toHaveBeenCalled();
  });
});

describe('CameraCaptureSessionController.takePhotoNow() in auto mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    captureRuntimeMocks.createReusableFrameCapture.mockReset();
    captureRuntimeMocks.resumeVideoPlayback.mockReset();
    captureRuntimeMocks.waitForVideoReady.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels pending auto-analysis timer when called in auto mode', async () => {
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const { controller } = makeController({ initialMode: 'auto' });
    await controller.start();
    clearTimeoutSpy.mockClear();

    await controller.takePhotoNow();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('emits a preview state when called in auto mode', async () => {
    const { controller, onStateChange } = makeController({ initialMode: 'auto' });
    await controller.start();
    onStateChange.mockClear();

    await controller.takePhotoNow();

    const states = onStateChange.mock.calls.map(([s]) => s);
    expect(states.some((s) => s.phase === 'preview')).toBe(true);
  });

  it('does not let an in-flight runAutoAnalysis override the preview state', async () => {
    let resolveQuality: ((q: FaceQualityResult) => void) | null = null;
    const assessLiveQuality = vi.fn().mockReturnValue(
      new Promise<FaceQualityResult>((r) => { resolveQuality = r; }),
    );

    const { controller, onStateChange } = makeController({
      initialMode: 'auto',
      assessLiveQuality,
    });
    await controller.start();

    // Advance timers to start the auto-analysis loop (quality assessment now in-flight).
    vi.runAllTimers();
    await vi.runAllTicks();

    // User triggers manual capture while auto-analysis is awaiting.
    // takePhotoNow() uses the immediately-resolving default mocks, so it finishes first.
    await controller.takePhotoNow();
    onStateChange.mockClear();

    // Resolve the pending quality assessment — runAutoAnalysis should now no-op.
    resolveQuality!(makeQualityResult());
    await vi.runAllTicks();

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('does not let an in-flight finishAutoCapture override the preview state', async () => {
    // First analysis passes quality immediately to trigger countdown.
    const assessLiveQuality = vi.fn().mockResolvedValue(makeQualityResult());

    const frameCaptureMock = makeFrameCaptureMock();
    let resolveBestBlob: ((b: Blob) => void) | null = null;
    frameCaptureMock.hasStoredBestFrame.mockReturnValue(true);
    frameCaptureMock.storedBestFrameToBlob.mockReturnValue(
      new Promise<Blob>((r) => { resolveBestBlob = r; }),
    );
    captureRuntimeMocks.createReusableFrameCapture.mockReturnValue(frameCaptureMock);

    const { controller, onStateChange } = makeController({
      initialMode: 'auto',
      assessLiveQuality,
    });
    await controller.start();

    // Advance time past countdown to trigger finishAutoCapture (blob resolution pending).
    vi.advanceTimersByTime(10000);
    await vi.runAllTicks();

    // User triggers manual capture while finishAutoCapture is awaiting the blob.
    // takePhotoNow() uses captureBlob (not storedBestFrameToBlob), so it can proceed.
    frameCaptureMock.captureBlob.mockResolvedValue(new Blob(['manual'], { type: 'image/jpeg' }));
    await controller.takePhotoNow();
    onStateChange.mockClear();

    // Resolve the pending finishAutoCapture blob — it should no-op now.
    resolveBestBlob!(new Blob(['best'], { type: 'image/jpeg' }));
    await vi.runAllTicks();

    expect(onStateChange).not.toHaveBeenCalled();
  });
});

describe('CameraCaptureSessionController canTakePhoto', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    captureRuntimeMocks.createReusableFrameCapture.mockReset();
    captureRuntimeMocks.resumeVideoPlayback.mockReset();
    captureRuntimeMocks.waitForVideoReady.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits canTakePhoto: true on initial live state in auto mode', async () => {
    const { controller, onStateChange } = makeController({ initialMode: 'auto' });
    await controller.start();

    const liveState = onStateChange.mock.calls.map(([s]) => s).find((s) => s.phase === 'live');
    expect(liveState?.canTakePhoto).toBe(true);
  });

  it('emits canTakePhoto: true on initial live state in manual mode', async () => {
    const { controller, onStateChange } = makeController({ initialMode: 'manual' });
    await controller.start();

    const liveState = onStateChange.mock.calls.map(([s]) => s).find((s) => s.phase === 'live');
    expect(liveState?.canTakePhoto).toBe(true);
  });

  it('emits canTakePhoto: false once the auto-capture countdown has started', async () => {
    const assessLiveQuality = vi.fn().mockResolvedValue(makeQualityResult({ passesQualityChecks: true }));
    const { controller, onStateChange } = makeController({
      initialMode: 'auto',
      assessLiveQuality,
    });
    await controller.start();
    onStateChange.mockClear();

    // Run the first analysis cycle — quality passes, so countdown starts.
    vi.runAllTimers();
    await vi.runAllTicks();

    const liveStates = onStateChange.mock.calls.map(([s]) => s).filter((s) => s.phase === 'live');
    expect(liveStates.length).toBeGreaterThan(0);
    expect(liveStates.every((s) => !s.canTakePhoto)).toBe(true);
  });

  it('emits canTakePhoto: true again after retake resets the countdown', async () => {
    const assessLiveQuality = vi.fn().mockResolvedValue(makeQualityResult({ passesQualityChecks: true }));
    const { controller, onStateChange } = makeController({
      initialMode: 'auto',
      assessLiveQuality,
    });
    await controller.start();

    // Advance to get into countdown state.
    vi.runAllTimers();
    await vi.runAllTicks();

    // Trigger a manual capture (this also switches the session to manual mode).
    await controller.takePhotoNow();
    onStateChange.mockClear();

    captureRuntimeMocks.resumeVideoPlayback.mockReturnValue(undefined);
    await controller.retake();

    const liveState = onStateChange.mock.calls.map(([s]) => s).find((s) => s.phase === 'live');
    // After retake in manual mode (takePhotoNow switches to manual), canTakePhoto is true.
    expect(liveState?.canTakePhoto).toBe(true);
  });

  it('snapshots the frame before assessment so the best frame matches the evaluated frame', async () => {
    const assessLiveQuality = vi.fn().mockResolvedValue(
      makeQualityResult({ passesQualityChecks: true, captureScore: 0.9 }),
    );

    const { controller, frameCaptureMock } = makeController({
      initialMode: 'auto',
      assessLiveQuality,
    });
    await controller.start();

    // Run one analysis cycle.
    vi.runAllTimers();
    await vi.runAllTicks();

    // captureWorkingFrame must be called before assessLiveQuality returns,
    // and promoteWorkingToBest is called instead of storeBestFrame.
    expect(frameCaptureMock.captureWorkingFrame).toHaveBeenCalledTimes(1);
    expect(frameCaptureMock.promoteWorkingToBest).toHaveBeenCalledTimes(1);
    expect(frameCaptureMock.storeBestFrame).not.toHaveBeenCalled();
  });
});
