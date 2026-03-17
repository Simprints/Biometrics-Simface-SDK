import type { SimFaceConfig, ValidateResult, EnrollResult, VerifyResult, APIError } from '../types/index.js';
import { resolveApiUrl } from '../shared/api-url.js';

export class SimFaceAPIClient {
  private readonly apiUrl: string;
  private readonly projectId: string;
  private readonly apiKey: string;

  constructor(config: SimFaceConfig) {
    this.apiUrl = resolveApiUrl(config.apiUrl);
    this.projectId = config.projectId;
    this.apiKey = config.apiKey;
  }

  async validateAPIKey(): Promise<ValidateResult> {
    const response = await fetch(`${this.apiUrl}/api/v1/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: this.projectId,
        apiKey: this.apiKey,
      }),
    });

    if (!response.ok) {
      const err: APIError = await response.json();
      throw new Error(err.error || 'API key validation failed');
    }

    return response.json();
  }

  async enroll(clientId: string, imageBlob: Blob): Promise<EnrollResult> {
    const formData = new FormData();
    formData.append('projectId', this.projectId);
    formData.append('apiKey', this.apiKey);
    formData.append('clientId', clientId);
    formData.append('image', imageBlob, 'face.jpg');

    const response = await fetch(`${this.apiUrl}/api/v1/enroll`, {
      method: 'POST',
      body: formData,
    });

    if (response.status === 409) {
      return { success: false, clientId, alreadyEnrolled: true, message: 'User already enrolled' };
    }

    if (!response.ok) {
      const err: APIError = await response.json();
      throw new Error(err.error || 'Enrollment failed');
    }

    return response.json();
  }

  async verify(clientId: string, imageBlob: Blob): Promise<VerifyResult> {
    const formData = new FormData();
    formData.append('projectId', this.projectId);
    formData.append('apiKey', this.apiKey);
    formData.append('clientId', clientId);
    formData.append('image', imageBlob, 'face.jpg');

    const response = await fetch(`${this.apiUrl}/api/v1/verify`, {
      method: 'POST',
      body: formData,
    });

    if (response.status === 404) {
      return { match: false, score: 0, threshold: 0, notEnrolled: true, message: 'User not enrolled' };
    }

    if (!response.ok) {
      const err: APIError = await response.json();
      throw new Error(err.error || 'Verification failed');
    }

    return response.json();
  }
}
