export const STORAGE_KEY = 'simface-demo-config';
export const DEFAULT_API_URL = 'https://simface-api-85584555549.europe-west1.run.app';

export function normalizeApiUrl(value) {
  if (typeof value !== 'string') {
    return DEFAULT_API_URL;
  }

  const normalized = value.trim();
  return normalized || DEFAULT_API_URL;
}

export function toStoredConfig(config = {}) {
  return {
    apiUrl: normalizeApiUrl(config.apiUrl),
    clientId: typeof config.clientId === 'string' ? config.clientId.trim() : '',
    presentationMode: config.presentationMode === 'popup' ? 'popup' : 'embedded',
  };
}

export function readStoredConfig(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return toStoredConfig();
    }

    return toStoredConfig(JSON.parse(raw));
  } catch {
    return toStoredConfig();
  }
}

export function writeStoredConfig(storage, config) {
  storage.setItem(STORAGE_KEY, JSON.stringify(toStoredConfig(config)));
}
