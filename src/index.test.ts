import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimFaceCaptureElement } from './types/index.js';

const captureMocks = vi.hoisted(() => ({
  captureFromCamera: vi.fn(),
}));

const apiClientMethodMocks = vi.hoisted(() => ({
  validateAPIKey: vi.fn(),
  enroll: vi.fn(),
  verify: vi.fn(),
}));

const apiClientConstructor = vi.hoisted(() => vi.fn(function () { return apiClientMethodMocks; }));

vi.mock('./services/camera.js', () => ({
  captureFromCamera: captureMocks.captureFromCamera,
  blobToImage: vi.fn(),
  blobToDataURL: vi.fn(),
}));

vi.mock('./services/api-client.js', () => ({
  SimFaceAPIClient: apiClientConstructor,
}));

vi.mock('./components/simface-capture.js', () => ({
  SimFaceCapture: class SimFaceCapture {},
}));

import { enroll, verify } from './index.js';

describe('SDK entrypoints', () => {
  const config = {
    apiUrl: 'https://example.invalid',
    projectId: 'project-1',
    apiKey: 'api-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    captureMocks.captureFromCamera.mockReset();
    apiClientMethodMocks.validateAPIKey.mockReset();
    apiClientMethodMocks.enroll.mockReset();
    apiClientMethodMocks.verify.mockReset();
    apiClientMethodMocks.validateAPIKey.mockResolvedValue(undefined);
  });

  it('passes capture options through enroll() before uploading the confirmed blob', async () => {
    const blob = new Blob(['capture'], { type: 'image/jpeg' });
    const workflowOptions = {
      capturePreference: 'manual-only' as const,
    };
    const captureComponent = document.createElement('simface-capture') as SimFaceCaptureElement;
    const captureOptions = {
      component: captureComponent,
    };

    captureMocks.captureFromCamera.mockResolvedValue(blob);
    apiClientMethodMocks.enroll.mockResolvedValue({
      success: true,
      clientId: 'user-1',
    });

    const result = await enroll(config, 'user-1', workflowOptions, captureOptions);

    expect(captureMocks.captureFromCamera).toHaveBeenCalledWith(workflowOptions, captureOptions);
    expect(apiClientMethodMocks.validateAPIKey).toHaveBeenCalledTimes(1);
    expect(apiClientMethodMocks.enroll).toHaveBeenCalledWith('user-1', blob);
    expect(result).toEqual({
      success: true,
      clientId: 'user-1',
    });
  });

  it('returns the capture-cancelled verify result without calling the backend verify endpoint', async () => {
    captureMocks.captureFromCamera.mockResolvedValue(null);

    const result = await verify(config, 'user-1', {
      capturePreference: 'auto-preferred',
    });

    expect(apiClientMethodMocks.validateAPIKey).toHaveBeenCalledTimes(1);
    expect(apiClientMethodMocks.verify).not.toHaveBeenCalled();
    expect(result).toEqual({
      match: false,
      score: 0,
      threshold: 0,
      message: 'Capture cancelled by user',
    });
  });
});
