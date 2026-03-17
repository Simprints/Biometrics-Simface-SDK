import { describe, it, expect, vi } from 'vitest';
import { SimFaceAPIClient } from '../services/api-client.js';

const DEFAULT_API_URL = 'https://simface-api-85584555549.europe-west1.run.app';

const mockConfig = {
  projectId: 'test-project',
  apiKey: 'test-key',
  apiUrl: 'https://api.example.com',
};

describe('SimFaceAPIClient', () => {
  describe('validateAPIKey', () => {
    it('should send correct request body', async () => {
      const mockResponse = { valid: true, projectId: 'test-project', name: 'Test' };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SimFaceAPIClient(mockConfig);
      const result = await client.validateAPIKey();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/auth/validate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'test-project', apiKey: 'test-key' }),
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('should throw on invalid API key', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'invalid credentials' }),
      });

      const client = new SimFaceAPIClient(mockConfig);
      await expect(client.validateAPIKey()).rejects.toThrow('invalid credentials');
    });
  });

  describe('enroll', () => {
    it('should send multipart form data', async () => {
      const mockResponse = { success: true, clientId: 'user-1' };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SimFaceAPIClient(mockConfig);
      const blob = new Blob(['fake image'], { type: 'image/jpeg' });
      const result = await client.enroll('user-1', blob);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/enroll',
        expect.objectContaining({ method: 'POST' }),
      );

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const formData = call[1].body as FormData;
      expect(formData.get('projectId')).toBe('test-project');
      expect(formData.get('apiKey')).toBe('test-key');
      expect(formData.get('clientId')).toBe('user-1');
      expect(formData.get('image')).toBeTruthy();
      expect(result.success).toBe(true);
    });

    it('should handle 409 conflict (already enrolled)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'already enrolled' }),
      });

      const client = new SimFaceAPIClient(mockConfig);
      const blob = new Blob(['fake'], { type: 'image/jpeg' });
      const result = await client.enroll('user-1', blob);

      expect(result.alreadyEnrolled).toBe(true);
      expect(result.success).toBe(false);
    });
  });

  describe('verify', () => {
    it('should return match result', async () => {
      const mockResponse = { match: true, score: 0.85, threshold: 0.6 };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SimFaceAPIClient(mockConfig);
      const blob = new Blob(['fake'], { type: 'image/jpeg' });
      const result = await client.verify('user-1', blob);

      expect(result.match).toBe(true);
      expect(result.score).toBe(0.85);
    });

    it('should handle 404 (not enrolled)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'not found' }),
      });

      const client = new SimFaceAPIClient(mockConfig);
      const blob = new Blob(['fake'], { type: 'image/jpeg' });
      const result = await client.verify('user-1', blob);

      expect(result.notEnrolled).toBe(true);
      expect(result.match).toBe(false);
    });
  });

  describe('URL handling', () => {
    it('should use the hosted backend when apiUrl is omitted', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ valid: true }),
      });

      const client = new SimFaceAPIClient({
        projectId: mockConfig.projectId,
        apiKey: mockConfig.apiKey,
      });
      await client.validateAPIKey();

      expect(fetch).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}/api/v1/auth/validate`,
        expect.anything(),
      );
    });

    it('should treat a blank apiUrl as missing and use the hosted backend', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ valid: true }),
      });

      const client = new SimFaceAPIClient({ ...mockConfig, apiUrl: '   ' });
      await client.validateAPIKey();

      expect(fetch).toHaveBeenCalledWith(
        `${DEFAULT_API_URL}/api/v1/auth/validate`,
        expect.anything(),
      );
    });

    it('should strip trailing slash from apiUrl', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ valid: true }),
      });

      const client = new SimFaceAPIClient({ ...mockConfig, apiUrl: 'https://api.example.com/' });
      await client.validateAPIKey();

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/auth/validate',
        expect.anything(),
      );
    });
  });
});
