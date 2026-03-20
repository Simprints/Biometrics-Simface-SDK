/**
 * E2E integration tests — exercises the real SimFace backend.
 *
 * These tests make actual HTTP calls and depend on the following env vars:
 *   SIMFACE_TEST_API_URL    — Backend base URL
 *   SIMFACE_TEST_PROJECT_ID — Project to enroll/verify against
 *   SIMFACE_TEST_API_KEY    — Valid API key for that project
 *
 * They are skipped gracefully when the env vars are absent (local dev, forks).
 *
 * Run manually:
 *   SIMFACE_TEST_API_URL=https://... \
 *   SIMFACE_TEST_PROJECT_ID=... \
 *   SIMFACE_TEST_API_KEY=... \
 *   npx vitest run --config vitest.integration.config.ts
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SimFaceAPIClient } from '../services/api-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_URL = process.env.SIMFACE_TEST_API_URL;
const PROJECT_ID = process.env.SIMFACE_TEST_PROJECT_ID;
const API_KEY = process.env.SIMFACE_TEST_API_KEY;

const hasCredentials = !!(API_URL && PROJECT_ID && API_KEY);

// Unique client ID per run to avoid collisions across parallel CI jobs
const CLIENT_ID = `ci-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function loadFixture(name: string): Blob {
  const buffer = readFileSync(resolve(__dirname, 'fixtures', name));
  return new Blob([buffer], { type: 'image/jpeg' });
}

describe.sequential.skipIf(!hasCredentials)('SDK integration (live backend)', () => {
  let client: SimFaceAPIClient;
  let faceA: Blob;
  let faceB: Blob;
  let faceC: Blob;

  beforeAll(() => {
    client = new SimFaceAPIClient({
      projectId: PROJECT_ID!,
      apiKey: API_KEY!,
      apiUrl: API_URL!,
    });

    faceA = loadFixture('face-a.jpg');
    faceB = loadFixture('face-b.jpg');
    faceC = loadFixture('face-c.jpg');
  });

  it('validates the API key', async () => {
    const result = await client.validateAPIKey();
    expect(result.valid).toBe(true);
    expect(result.projectId).toBe(PROJECT_ID);
  }, 30_000);

  it('enrolls a new user with face-a', async () => {
    const result = await client.enroll(CLIENT_ID, faceA);
    expect(result.success).toBe(true);
    expect(result.clientId).toBe(CLIENT_ID);
    expect(result.alreadyEnrolled).toBeFalsy();
  }, 30_000);

  it('verifies the enrolled user with face-b (same person, match)', async () => {
    const result = await client.verify(CLIENT_ID, faceB);
    expect(result.match).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.notEnrolled).toBeFalsy();
  }, 30_000);

  it('verifies the enrolled user with face-c (different person, no match)', async () => {
    const result = await client.verify(CLIENT_ID, faceC);
    expect(result.match).toBe(false);
    expect(result.notEnrolled).toBeFalsy();
  }, 30_000);

  it('returns alreadyEnrolled when enrolling the same user again', async () => {
    const result = await client.enroll(CLIENT_ID, faceA);
    expect(result.alreadyEnrolled).toBe(true);
  }, 30_000);

  it('returns notEnrolled when verifying an unknown user', async () => {
    const unknownId = `unknown-${Date.now()}`;
    const result = await client.verify(unknownId, faceA);
    expect(result.notEnrolled).toBe(true);
    expect(result.match).toBe(false);
  }, 30_000);
});
