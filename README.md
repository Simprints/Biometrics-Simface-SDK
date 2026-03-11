# SimFace SDK

SimFace SDK provides facial recognition for web-based KYC workflows. It exposes one primary JavaScript API for enrollment and verification, plus a lower-level Web Component for advanced UI control.

Works in: all modern browsers, WhatsApp in-app browser, and mobile WebViews.

This repository is the public frontend SDK and demo repo for SimFace. For frontend architecture and contributor setup, see [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md).

For repository policies and contribution guidance, see [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [LICENSE](LICENSE).

The backend API, infrastructure, and TensorFlow Lite runtime live in the separate private backend repository.

The capture flow is planned explicitly as: auto camera -> manual camera -> media picker. The primary API supports two UI modes:
- popup capture: the SDK opens and manages its own modal capture flow
- embedded capture: the SDK runs capture inside a host-provided `simface-capture` element

## Face Quality Checks

The SDK automatically performs these checks on captured images before submission:

1. Face presence - at least one face must be detected.
2. Single face - only one face should be in the frame.
3. Face size - face must not be too close or too far.
4. Centering - face must be approximately centered in the frame.

If a check fails, the user is prompted with specific guidance and asked to retake the photo.

## Quick Start

### 1. Include the SDK

**Option A — npm:**
```bash
npm install @simprints/simface-sdk
```
```javascript
import { enroll, verify } from '@simprints/simface-sdk';
```

**Option B — direct script include:**

Download the SDK files from the [latest GitHub Release](../../releases/latest) and include them directly:
```html
<script type="module" src="simface-sdk.js"></script>
```

The release contains two builds:
- `simface-sdk.js` (ES module)
- `simface-sdk.umd.cjs` (UMD/CommonJS build)

### 2. Configure

```javascript
const config = {
  apiUrl: 'https://your-simface-api.run.app',
  projectId: 'your-project-id',
  apiKey: 'your-api-key',
};
```

### Security considerations

- Treat `apiKey` as a browser-visible credential. Do not hardcode long-lived secrets into shipped frontend bundles.
- Prefer issuing short-lived credentials or session-bound tokens from your own backend for each capture session.
- Keep `apiUrl` on HTTPS in production and make sure the backend only accepts trusted origins and authorized project IDs.
- The local demo does **not** persist project IDs or API keys to `localStorage`; it only remembers the API URL, presentation mode, and client ID between reloads.

### 3. Enroll a User

```javascript
import { enroll } from '@simprints/simface-sdk';

const result = await enroll(config, 'unique-user-id');

if (result.success) {
  console.log('User enrolled successfully!');
} else if (result.alreadyEnrolled) {
  console.log('User is already enrolled - use verify() instead.');
} else {
  console.log('Enrollment failed:', result.message);
}
```

### 4. Verify a User

```javascript
import { verify } from '@simprints/simface-sdk';

const result = await verify(config, 'unique-user-id');

if (result.match) {
  console.log(`Identity verified! (score: ${result.score})`);
} else if (result.notEnrolled) {
  console.log('User not enrolled - use enroll() first.');
} else {
  console.log(`Verification failed (score: ${result.score}, threshold: ${result.threshold})`);
}
```

### 5. Choose the capture UI mode

`enroll()` and `verify()` are the main SDK entry points. They both use the same capture workflow and backend API. The only UI difference is where the capture UI is rendered.

Both functions accept:
- `workflowOptions`: optional capture behavior that applies to both popup and embedded flows
- `captureElement`: optional existing `simface-capture` element; if this argument is present, the SDK uses embedded mode

#### Popup capture

If you omit `captureElement`, the SDK opens its popup capture UI:

```javascript
const workflowOptions = {
  capturePreference: 'auto-preferred',
  allowMediaPickerFallback: true,
};

const enrollResult = await enroll(config, 'unique-user-id', workflowOptions);
const verifyResult = await verify(config, 'unique-user-id', workflowOptions);
```

#### Embedded capture

If you want capture inline in your page, create a `simface-capture` element and pass it as `captureElement`. The SDK still owns the capture lifecycle; it just renders the UI inline instead of in a popup.

```html
<simface-capture
  embedded
  capture-preference="auto-preferred"
  label="Take a selfie for verification"
  idle-feedback-label="Start verification to see camera guidance here."
  capture-label="Snap photo"
  retake-label="Take another"
  confirm-label="Use this photo"
  retry-label="Start over"
></simface-capture>
```

```javascript
const workflowOptions = {
  capturePreference: 'auto-preferred',
  allowMediaPickerFallback: true,
};

const captureElement = document.querySelector('simface-capture');

const enrollResult = await enroll(config, 'unique-user-id', workflowOptions, captureElement);
const verifyResult = await verify(config, 'unique-user-id', workflowOptions, captureElement);
```

| workflowOptions | Type | Default | Notes |
|--------|------|---------|-------|
| `capturePreference` | `'auto-preferred' \| 'manual-only'` | `'auto-preferred'` | Controls auto vs manual shutter |
| `allowMediaPickerFallback` | `boolean` | `true` | Falls back to file picker if camera is unavailable |

## API Reference

### Primary SDK API

The main integration surface is:
- `enroll(config, clientId, workflowOptions?, captureElement?)`
- `verify(config, clientId, workflowOptions?, captureElement?)`

These functions:
- run the camera capture workflow
- manage popup or embedded capture UI
- perform face quality validation
- call the backend API for enrollment or verification

### `enroll(config, clientId, workflowOptions?, captureElement?): Promise<EnrollResult>`

Opens the camera, captures a face image with quality validation, and enrolls the user.

Parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `SimFaceConfig` | SDK configuration (`apiUrl`, `projectId`, `apiKey`) |
| `clientId` | `string` | Unique identifier for the user |
| `workflowOptions` | `SimFaceWorkflowOptions` | Optional popup/embedded-agnostic capture behavior |
| `captureElement` | `SimFaceCaptureElement` | Optional embedded `simface-capture` element |

Returns: `EnrollResult`

### `verify(config, clientId, workflowOptions?, captureElement?): Promise<VerifyResult>`

Opens the camera, captures a face image, and verifies against the enrolled face.

Parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `SimFaceConfig` | SDK configuration (`apiUrl`, `projectId`, `apiKey`) |
| `clientId` | `string` | Unique identifier for the user |
| `workflowOptions` | `SimFaceWorkflowOptions` | Optional popup/embedded-agnostic capture behavior |
| `captureElement` | `SimFaceCaptureElement` | Optional embedded `simface-capture` element |

Returns: `VerifyResult`

### `SimFaceAPIClient` and the backend REST interface

`SimFaceAPIClient` is the lower-level HTTP client used internally by `enroll()` and `verify()`. Use it when you want direct control over when capture happens and when backend calls are made.

Typical cases for using `SimFaceAPIClient` directly:
- advanced UI flows driven by your own application state
- direct use of the `simface-capture` component
- custom orchestration where capture and backend submission happen in separate steps

At a high level:
- `enroll()` and `verify()` = capture UI + quality checks + backend submission
- `SimFaceAPIClient` = backend submission only

`SimFaceAPIClient` maps directly to the backend REST interface:
- `validateAPIKey()` -> `POST /api/v1/auth/validate`
- `enroll(clientId, imageBlob)` -> `POST /api/v1/enroll`
- `verify(clientId, imageBlob)` -> `POST /api/v1/verify`

## Advanced: Direct `simface-capture` control

Use the `simface-capture` Web Component directly when you want the host application to manage capture state itself instead of letting `enroll()` or `verify()` orchestrate it. In this mode, the component is also the source of truth for embedded UI copy.

```html
<simface-capture
  embedded
  capture-preference="auto-preferred"
  label="Take a selfie for verification"
  idle-feedback-label="Start verification to see camera guidance here."
  capture-label="Snap photo"
  retake-label="Take another"
  confirm-label="Use this photo"
  retry-label="Start over"
></simface-capture>

<script type="module">
  import '@simprints/simface-sdk';
  import { SimFaceAPIClient } from '@simprints/simface-sdk';

  const captureEl = document.querySelector('simface-capture');
  const client = new SimFaceAPIClient({
    apiUrl: 'https://your-simface-api.run.app',
    projectId: 'your-project-id',
    apiKey: 'your-api-key',
  });

  captureEl.addEventListener('simface-captured', async (e) => {
    const { imageBlob } = e.detail;
    const result = await client.verify('user-123', imageBlob);
    console.log('Verify result:', result);
  });

  captureEl.addEventListener('simface-cancelled', () => {
    console.log('User cancelled capture');
  });

  captureEl.addEventListener('simface-error', (e) => {
    console.error('Capture error:', e.detail.error);
  });

  await captureEl.startCapture();
</script>
```

In this advanced flow:
1. the host renders the component
2. the host starts capture with `startCapture()` or by setting `active = true`
3. the component emits capture events
4. the host decides what backend call to make with `SimFaceAPIClient`

This is more flexible, but it also means the host owns more of the workflow.

### Component Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `label` | String | `"Capturing Face"` | Primary instructional text shown by the component |
| `idle-feedback-label` | String | `"Start a capture to see camera guidance here."` | Idle guidance text shown in the feedback area before capture begins |
| `embedded` | Boolean | `false` | Runs the component inline instead of delegating to the popup capture service |
| `capture-label` | String | `"Take photo"` | Manual capture button label |
| `retake-label` | String | `"Retake"` | Preview retake button label |
| `confirm-label` | String | `"Accept"` | Confirm button label used in preview state |
| `retry-label` | String | `"Try again"` | Error-state retry button label |
| `capture-preference` | `"auto-preferred" \| "manual-only"` | `"auto-preferred"` | Whether auto capture should be preferred or disabled |
| `allow-media-picker-fallback` | Boolean | `true` | Whether the component may fall back to the media picker if camera capture is unavailable |

### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `simface-captured` | `{ imageBlob: Blob }` | Fires when a quality-checked face image is confirmed |
| `simface-cancelled` | - | Fires when the user cancels the capture flow |
| `simface-error` | `{ error: string }` | Fires on capture/detection errors |

## Type Definitions

### `SimFaceConfig`

```typescript
interface SimFaceConfig {
  apiUrl: string;
  projectId: string;
  apiKey: string;
}
```

### `SimFaceWorkflowOptions`

```typescript
interface SimFaceWorkflowOptions {
  capturePreference?: 'auto-preferred' | 'manual-only';
  allowMediaPickerFallback?: boolean;
}
```

### `EnrollResult`

```typescript
interface EnrollResult {
  success: boolean;
  clientId: string;
  message?: string;
  alreadyEnrolled?: boolean;
}
```

### `VerifyResult`

```typescript
interface VerifyResult {
  match: boolean;
  score: number;
  threshold: number;
  message?: string;
  notEnrolled?: boolean;
}
```

## Backend API Endpoints

For clients integrating directly with the REST API:

### `POST /api/v1/auth/validate`
Validate API credentials.

Body: `{ "projectId": "...", "apiKey": "..." }`
Response: `{ "valid": true, "projectId": "...", "name": "..." }`

### `POST /api/v1/enroll`
Enroll a new user.

Body: multipart form data with fields `projectId`, `apiKey`, `clientId`, `image`.
Response: `{ "success": true, "clientId": "..." }`

### `POST /api/v1/verify`
Verify a user against their enrollment.

Body: multipart form data with fields `projectId`, `apiKey`, `clientId`, `image`.
Response: `{ "match": true, "score": 0.85, "threshold": 0.6 }`

### `GET /api/v1/health`
Health check endpoint.

Response: `{ "status": "ok" }`

## Browser Compatibility

| Browser | Camera Capture | Face Detection |
|---------|---------------|----------------|
| Chrome (Android/Desktop) | Yes | Yes |
| Safari (iOS/Desktop) | Yes | Yes |
| WhatsApp in-app browser | Yes (via native camera) | Yes |
| Firefox | Yes | Yes |
| Samsung Internet | Yes | Yes |

> Note: In WhatsApp's in-app browser, the camera opens via the device's native camera app rather than an in-browser preview. Face quality checks run after the photo is taken.

## Try the local demo

Build the SDK at the repository root, then run the demo:

```bash
npm install
npm run build

cd demo
npm install
npm run dev
```

The demo runs at `http://localhost:4173` and consumes the built SDK artifact from `dist/`. To enable HTTPS (required for camera access from other devices on the local network), set `DEMO_USE_HTTPS=true` before starting the demo.

The demo defaults its backend URL to `http://localhost:8080` so public clones do not automatically target a hosted SimFace service.
