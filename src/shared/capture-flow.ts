import { getVideoDetector } from '../services/face-detection.js';
import type {
  CapturePreference,
  CapturePresentation,
  SimFaceCaptureOptions,
} from '../types/index.js';

export type CapturePlanStep = 'auto-camera' | 'manual-camera' | 'media-picker';

export interface NormalizedCaptureOptions {
  presentation: CapturePresentation;
  capturePreference: CapturePreference;
  allowMediaPickerFallback: boolean;
  container?: HTMLElement | string;
  label: string;
  confirmLabel: string;
}

export interface CaptureCapabilities {
  prefersMediaPicker: boolean;
  supportsMediaDevices: boolean;
  supportsAutoCapture: boolean;
}

export interface CapturePlan {
  presentation: CapturePresentation;
  steps: CapturePlanStep[];
  capabilities: CaptureCapabilities;
}

export const DEFAULT_LABEL = 'Capturing Face';
export const DEFAULT_CONFIRM_LABEL = 'Accept';

export function normalizeCaptureOptions(
  options: SimFaceCaptureOptions | undefined,
): NormalizedCaptureOptions {
  return {
    presentation: options?.presentation ?? 'popup',
    capturePreference: options?.capturePreference ?? 'auto-preferred',
    allowMediaPickerFallback: options?.allowMediaPickerFallback ?? true,
    container: options?.container,
    label: options?.label ?? DEFAULT_LABEL,
    confirmLabel: options?.confirmLabel ?? DEFAULT_CONFIRM_LABEL,
  };
}

export async function resolveCaptureCapabilities(options: {
  capturePreference: CapturePreference;
  userAgent?: string;
  hasMediaDevices?: boolean;
  probeAutoCapture?: () => Promise<boolean>;
}): Promise<CaptureCapabilities> {
  const prefersMediaPicker = /WhatsApp/i.test(options.userAgent ?? navigator.userAgent);
  const supportsMediaDevices =
    options.hasMediaDevices ?? typeof navigator.mediaDevices?.getUserMedia === 'function';

  let supportsAutoCapture = false;
  if (!prefersMediaPicker && supportsMediaDevices && options.capturePreference === 'auto-preferred') {
    supportsAutoCapture = await (options.probeAutoCapture?.() ?? supportsRealtimeAutoCapture());
  }

  return {
    prefersMediaPicker,
    supportsMediaDevices,
    supportsAutoCapture,
  };
}

export function buildCapturePlan(
  options: NormalizedCaptureOptions,
  capabilities: CaptureCapabilities,
): CapturePlan {
  const steps: CapturePlanStep[] = [];

  if (capabilities.supportsMediaDevices) {
    if (options.capturePreference === 'auto-preferred' && capabilities.supportsAutoCapture) {
      steps.push('auto-camera');
    }
    steps.push('manual-camera');
  }

  if (
    options.allowMediaPickerFallback
    && (steps.length === 0 || steps[steps.length - 1] !== 'media-picker')
  ) {
    steps.push('media-picker');
  }

  return {
    presentation: options.presentation,
    steps,
    capabilities,
  };
}

async function supportsRealtimeAutoCapture(): Promise<boolean> {
  if (
    typeof window.requestAnimationFrame !== 'function'
    || typeof window.cancelAnimationFrame !== 'function'
  ) {
    return false;
  }

  if (!document.createElement('canvas').getContext('2d')) {
    return false;
  }

  try {
    await getVideoDetector();
    return true;
  } catch {
    return false;
  }
}
