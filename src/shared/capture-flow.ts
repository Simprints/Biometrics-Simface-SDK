import { getVideoDetector } from '../services/face-detection.js';
import type {
  CapturePreference,
  SimFaceCaptureElement,
  SimFaceWorkflowOptions,
} from '../types/index.js';

export type CapturePlanStep = 'auto-camera' | 'manual-camera' | 'media-picker';

export interface NormalizedCaptureOptions {
  capturePreference: CapturePreference;
  allowMediaPickerFallback: boolean;
  component?: SimFaceCaptureElement;
  label: string;
  confirmLabel: string;
  captureLabel: string;
  retakeLabel: string;
  retryLabel: string;
}

export interface CaptureCapabilities {
  prefersMediaPicker: boolean;
  supportsMediaDevices: boolean;
  supportsAutoCapture: boolean;
}

export interface CapturePlan {
  steps: CapturePlanStep[];
  capabilities: CaptureCapabilities;
}

export const DEFAULT_LABEL = 'Capturing Face';
export const DEFAULT_CONFIRM_LABEL = 'Accept';
export const DEFAULT_CAPTURE_LABEL = 'Take photo';
export const DEFAULT_RETAKE_LABEL = 'Retake';
export const DEFAULT_RETRY_LABEL = 'Try again';

export function normalizeCaptureOptions(
  workflowOptions: SimFaceWorkflowOptions | undefined,
  component?: SimFaceCaptureElement,
): NormalizedCaptureOptions {
  return {
    capturePreference: workflowOptions?.capturePreference ?? 'auto-preferred',
    allowMediaPickerFallback: workflowOptions?.allowMediaPickerFallback ?? true,
    component,
    label: DEFAULT_LABEL,
    confirmLabel: DEFAULT_CONFIRM_LABEL,
    captureLabel: DEFAULT_CAPTURE_LABEL,
    retakeLabel: DEFAULT_RETAKE_LABEL,
    retryLabel: DEFAULT_RETRY_LABEL,
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
