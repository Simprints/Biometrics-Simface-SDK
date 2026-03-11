import { describe, expect, it, vi } from 'vitest';
import {
  buildCapturePlan,
  normalizeCaptureOptions,
  resolveCaptureCapabilities,
} from './capture-flow.js';

describe('capture flow planning', () => {
  it('prefers auto capture, then manual capture, then media picker when all strategies are available', async () => {
    const options = normalizeCaptureOptions({
      capturePreference: 'auto-preferred',
    });
    const capabilities = await resolveCaptureCapabilities({
      capturePreference: options.capturePreference,
      hasMediaDevices: true,
      probeAutoCapture: vi.fn().mockResolvedValue(true),
    });

    expect(buildCapturePlan(options, capabilities).steps).toEqual([
      'auto-camera',
      'manual-camera',
      'media-picker',
    ]);
  });

  it('falls back to manual capture and media picker when auto capture is unavailable', async () => {
    const options = normalizeCaptureOptions({
      capturePreference: 'auto-preferred',
    });
    const capabilities = await resolveCaptureCapabilities({
      capturePreference: options.capturePreference,
      hasMediaDevices: true,
      probeAutoCapture: vi.fn().mockResolvedValue(false),
    });

    expect(buildCapturePlan(options, capabilities).steps).toEqual([
      'manual-camera',
      'media-picker',
    ]);
  });

  it('skips the auto probe entirely when manual capture is explicitly requested', async () => {
    const probeAutoCapture = vi.fn().mockResolvedValue(true);
    const options = normalizeCaptureOptions({
      capturePreference: 'manual-only',
    });
    const capabilities = await resolveCaptureCapabilities({
      capturePreference: options.capturePreference,
      hasMediaDevices: true,
      probeAutoCapture,
    });

    expect(probeAutoCapture).not.toHaveBeenCalled();
    expect(buildCapturePlan(options, capabilities).steps).toEqual([
      'manual-camera',
      'media-picker',
    ]);
  });

  it('uses the media picker as the terminal fallback when no camera APIs are available', async () => {
    const options = normalizeCaptureOptions(undefined);
    const capabilities = await resolveCaptureCapabilities({
      capturePreference: options.capturePreference,
      hasMediaDevices: false,
      probeAutoCapture: vi.fn(),
    });

    expect(buildCapturePlan(options, capabilities).steps).toEqual(['media-picker']);
  });

  it('disables auto capture in WhatsApp but still preserves manual capture before the media picker', async () => {
    const options = normalizeCaptureOptions({
      capturePreference: 'auto-preferred',
    });
    const capabilities = await resolveCaptureCapabilities({
      capturePreference: options.capturePreference,
      userAgent: 'Mozilla/5.0 WhatsApp/2.24.0',
      hasMediaDevices: true,
      probeAutoCapture: vi.fn().mockResolvedValue(true),
    });

    expect(capabilities.supportsAutoCapture).toBe(false);
    expect(buildCapturePlan(options, capabilities).steps).toEqual([
      'manual-camera',
      'media-picker',
    ]);
  });
});
