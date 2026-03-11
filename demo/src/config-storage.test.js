import { describe, expect, it } from 'vitest';

import { DEFAULT_API_URL, readStoredConfig, toStoredConfig, writeStoredConfig } from './config-storage.js';

describe('demo config storage', () => {
  it('defaults to the hosted demo backend when nothing is stored', () => {
    const storage = {
      getItem: () => null,
    };

    expect(readStoredConfig(storage)).toEqual({
      apiUrl: DEFAULT_API_URL,
      clientId: '',
      presentationMode: 'embedded',
    });
  });

  it('only persists non-sensitive fields', () => {
    expect(toStoredConfig({
      apiUrl: ' https://demo.example.com ',
      projectId: 'project-1',
      apiKey: 'secret-key',
      clientId: ' demo-user ',
      presentationMode: 'popup',
    })).toEqual({
      apiUrl: 'https://demo.example.com',
      clientId: 'demo-user',
      presentationMode: 'popup',
    });
  });

  it('drops legacy stored credentials and normalizes invalid values', () => {
    const storage = {
      getItem: () => JSON.stringify({
        apiUrl: '',
        projectId: 'legacy-project',
        apiKey: 'legacy-secret',
        clientId: ' user-123 ',
        presentationMode: 'something-else',
      }),
    };

    expect(readStoredConfig(storage)).toEqual({
      apiUrl: DEFAULT_API_URL,
      clientId: 'user-123',
      presentationMode: 'embedded',
    });
  });

  it('writes sanitized data back to storage', () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };

    writeStoredConfig(storage, {
      apiUrl: '',
      projectId: 'ignored-project',
      apiKey: 'ignored-key',
      clientId: 'abc',
      presentationMode: 'embedded',
    });

    expect(JSON.parse(values.get('simface-demo-config'))).toEqual({
      apiUrl: DEFAULT_API_URL,
      clientId: 'abc',
      presentationMode: 'embedded',
    });
  });
});
