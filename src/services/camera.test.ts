import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blobToDataURL, captureFromCamera } from '../services/camera.js';

const originalUserAgent = navigator.userAgent;
const originalMediaDevices = navigator.mediaDevices;
const originalPlay = HTMLMediaElement.prototype.play;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

describe('camera service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    setUserAgent(originalUserAgent);
    setMediaDevices(originalMediaDevices);
    HTMLMediaElement.prototype.play = originalPlay;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('captureFromCamera', () => {
    it('should use in-browser camera capture on standard browsers', async () => {
      setUserAgent('Mozilla/5.0 Chrome/122.0 Safari/537.36');

      const stop = vi.fn();
      const getUserMedia = vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      } as unknown as MediaStream);

      setMediaDevices({ getUserMedia } as MediaDevices);

      HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
      HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D);

      const capturedBlob = new Blob(['image data'], { type: 'image/jpeg' });
      HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
        callback(capturedBlob);
      });

      const capturePromise = captureFromCamera();
      await Promise.resolve();
      await Promise.resolve();

      const video = document.querySelector('video') as HTMLVideoElement | null;
      expect(video).not.toBeNull();

      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
      video.dispatchEvent(new Event('loadedmetadata'));
      await Promise.resolve();

      const captureButton = document.querySelector('[data-simface-action="capture"]') as HTMLButtonElement | null;
      expect(captureButton).not.toBeNull();
      if (!captureButton) {
        throw new Error('Capture button was not rendered.');
      }
      captureButton.disabled = false;
      captureButton.dispatchEvent(new MouseEvent('click'));

      const result = await capturePromise;

      expect(result).toBe(capturedBlob);
      expect(getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: { ideal: 'user' } },
        audio: false,
      });
      expect(stop).toHaveBeenCalled();
    });

    it('should fall back to file input capture in WhatsApp', async () => {
      setUserAgent('Mozilla/5.0 WhatsApp/2.24.0');

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

    it('should reject when in-browser capture is unavailable outside WhatsApp', async () => {
      setUserAgent('Mozilla/5.0 Chrome/122.0 Safari/537.36');
      setMediaDevices(undefined);

      await expect(captureFromCamera()).rejects.toThrow('In-browser camera capture is not supported in this browser.');
    });

    it('should stop the camera stream if the capture UI fails to open', async () => {
      setUserAgent('Mozilla/5.0 Chrome/122.0 Safari/537.36');

      const stop = vi.fn();
      const getUserMedia = vi.fn().mockResolvedValue({
        getTracks: () => [{ stop }],
      } as unknown as MediaStream);

      setMediaDevices({ getUserMedia } as MediaDevices);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
        throw new Error('append failed');
      });

      await expect(captureFromCamera()).rejects.toThrow('append failed');
      expect(stop).toHaveBeenCalled();
    });
  });

  describe('blobToDataURL', () => {
    it('should convert blob to data URL', async () => {
      const blob = new Blob(['hello'], { type: 'text/plain' });
      const url = await blobToDataURL(blob);
      expect(url).toMatch(/^data:/);
    });
  });
});

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
