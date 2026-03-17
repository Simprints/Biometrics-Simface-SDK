export const DEFAULT_SIMFACE_API_URL = 'https://simface-api-85584555549.europe-west1.run.app';

export function resolveApiUrl(apiUrl?: string): string {
  if (typeof apiUrl !== 'string') {
    return DEFAULT_SIMFACE_API_URL;
  }

  const normalizedApiUrl = apiUrl.trim().replace(/\/$/, '');
  return normalizedApiUrl || DEFAULT_SIMFACE_API_URL;
}
