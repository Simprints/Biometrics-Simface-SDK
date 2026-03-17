import type { SimFaceConfig, ValidateResult, EnrollResult, VerifyResult, APIError } from '../types/index.js';
import { resolveApiUrl } from '../shared/api-url.js';

async function getAPIErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const err = await response.json() as Partial<APIError>;
    if (typeof err.error === 'string' && err.error.trim()) {
      return err.error.trim();
    }
  } catch {
    // Ignore malformed or empty error payloads and fall back to a stable message.
  }

  return `${fallback} (HTTP ${response.status})`;
}

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
      throw new Error(await getAPIErrorMessage(response, 'API key validation failed'));
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
      throw new Error(await getAPIErrorMessage(response, 'Enrollment failed'));
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
      throw new Error(await getAPIErrorMessage(response, 'Verification failed'));
    }

    return response.json();
  }
}
