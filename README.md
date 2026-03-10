# SimFace SDK

SimFace SDK provides facial recognition for web-based KYC workflows. It exposes one primary JavaScript API for enrollment and verification, plus a lower-level Web Component for advanced UI control.

Works in: all modern browsers, WhatsApp in-app browser, and mobile WebViews.

This repository is the public frontend SDK and demo repo for SimFace. For frontend architecture and contributor setup, see [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md).

The backend API, infrastructure, and TensorFlow Lite runtime live in the separate private backend repository.

The capture flow is planned explicitly as: auto camera -> manual camera -> media picker. The primary API supports two UI modes:
- popup capture: the SDK opens and manages its own modal capture flow
- embedded capture: the SDK runs capture inside a host-provided `simface-capture` element or container

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

#### Popup capture

If you omit embedded configuration, the SDK opens its popup capture UI:

```javascript
const captureOptions = {
  capturePreference: 'auto-preferred',
  allowMediaPickerFallback: true,
  label: 'Take a selfie for verification',
  confirmLabel: 'Use this photo',
};

const enrollResult = await enroll(config, 'unique-user-id', captureOptions);
const verifyResult = await verify(config, 'unique-user-id', captureOptions);
```

#### Embedded capture

If you want capture inline in your page, pass embedded configuration. The SDK still owns the capture lifecycle; it just renders the UI inline instead of in a popup.

```javascript
const captureOptions = {
  // Current API: embedded mode is enabled explicitly.
  presentation: 'embedded',

  // 'auto-preferred' (default) uses automatic face-framing capture when supported,
  // falling back to manual shutter. 'manual-only' always shows a manual shutter button.
  capturePreference: 'auto-preferred',

  // When true (default), falls back to the device media/file picker if camera access
  // is unavailable (e.g. denied permissions, or WhatsApp in-app browser).
  allowMediaPickerFallback: true,

  // Specifies the host container element for embedded capture.
  // This may be a CSS selector string or an HTMLElement.
  container: '#capture-slot',

  // Optional UI label overrides.
  label: 'Take a selfie for verification',
  confirmLabel: 'Use this photo',
};

const enrollResult = await enroll(config, 'unique-user-id', captureOptions);
const verifyResult = await verify(config, 'unique-user-id', captureOptions);
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `presentation` | `'popup' \| 'embedded'` | `'popup'` | Selects whether the SDK renders capture in a popup or inline |
| `capturePreference` | `'auto-preferred' \| 'manual-only'` | `'auto-preferred'` | Controls auto vs manual shutter |
| `allowMediaPickerFallback` | `boolean` | `true` | Falls back to file picker if camera is unavailable |
| `container` | `HTMLElement \| string` | — | Required when `presentation` is `'embedded'` |
| `label` | `string` | `'Capturing Face'` | Primary instructional text shown by the capture UI |
| `confirmLabel` | `string` | `'Accept'` | Confirm button label in preview state |

#### How the embedded flow works

When `presentation: 'embedded'` is provided with a `container`:
1. the host calls `enroll()` or `verify()`
2. the SDK resolves the container
3. the SDK finds or creates a `simface-capture` component inside that container
4. the SDK starts capture and listens for capture events
5. the SDK submits the confirmed image to the backend API

When popup mode is used:
1. the host calls `enroll()` or `verify()`
2. the SDK opens its popup capture UI
3. the SDK starts capture and listens for capture events
4. the SDK submits the confirmed image to the backend API

Today, popup vs embedded is selected with `presentation`. The host still uses the same top-level API either way; only the rendering mode changes.

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

## API Reference

### Primary SDK API

The main integration surface is:
- `enroll(config, clientId, captureOptions?)`
- `verify(config, clientId, captureOptions?)`

These functions:
- run the camera capture workflow
- manage popup or embedded capture UI
- perform face quality validation
- call the backend API for enrollment or verification

### `enroll(config, clientId, captureOptions?): Promise<EnrollResult>`

Opens the camera, captures a face image with quality validation, and enrolls the user.

Parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `SimFaceConfig` | SDK configuration (`apiUrl`, `projectId`, `apiKey`) |
| `clientId` | `string` | Unique identifier for the user |
| `captureOptions` | `SimFaceCaptureOptions` | Optional capture behavior and embedded container overrides |

Returns `EnrollResult`:
```typescript
{
  success: boolean;
  clientId: string;
  message?: string;
  alreadyEnrolled?: boolean;
}
```

### `verify(config, clientId, captureOptions?): Promise<VerifyResult>`

Opens the camera, captures a face image, and verifies against the enrolled face.

Parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `SimFaceConfig` | SDK configuration (`apiUrl`, `projectId`, `apiKey`) |
| `clientId` | `string` | Unique identifier for the user |
| `captureOptions` | `SimFaceCaptureOptions` | Optional capture behavior and embedded container overrides |

Returns `VerifyResult`:
```typescript
{
  match: boolean;
  score: number;
  threshold: number;
  message?: string;
  notEnrolled?: boolean;
}
```

### `SimFaceAPIClient` and the backend REST interface

`SimFaceAPIClient` is the lower-level HTTP client used internally by `enroll()` and `verify()`. Use it when you want direct control over when capture happens and when backend calls are made.

Typical cases for using `SimFaceAPIClient` directly:
- advanced UI flows driven by your own application state
- direct use of the `simface-capture` component
- custom orchestration where capture and backend submission happen in separate steps

At a high level:
- `enroll()` and `verify()` = capture UI + quality checks + backend submission
- `SimFaceAPIClient` = backend submission only

## Advanced: Direct `simface-capture` control

Use the `simface-capture` Web Component directly when you want the host application to manage capture state itself instead of letting `enroll()` or `verify()` orchestrate it.

```html
<simface-capture
  embedded
  capture-preference="auto-preferred"
  label="Take a selfie for verification"
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
| `label` | String | `"Capturing Face"` | Instructional text shown on the capture button |
| `embedded` | Boolean | `false` | Runs the component inline instead of delegating to the popup capture service |
| `confirm-label` | String | `"Accept"` | Confirm button label used in preview state |
| `capture-preference` | `"auto-preferred" \| "manual-only"` | `"auto-preferred"` | Whether auto capture should be preferred or disabled |
| `allow-media-picker-fallback` | Boolean | `true` | Whether the component may fall back to the media picker if camera capture is unavailable |

### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `simface-captured` | `{ imageBlob: Blob }` | Fires when a quality-checked face image is confirmed |
| `simface-cancelled` | - | Fires when the user cancels the capture flow |
| `simface-error` | `{ error: string }` | Fires on capture/detection errors |

### `SimFaceConfig`

```typescript
{
  apiUrl: string;
  projectId: string;
  apiKey: string;
}
```

### `SimFaceCaptureOptions`

```typescript
{
  presentation?: 'popup' | 'embedded';
  capturePreference?: 'auto-preferred' | 'manual-only';
  allowMediaPickerFallback?: boolean;
  container?: HTMLElement | string;
  label?: string;
  confirmLabel?: string;
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

## Face Quality Checks

The SDK automatically performs these checks on captured images before submission:

1. Face presence - at least one face must be detected.
2. Single face - only one face should be in the frame.
3. Face size - face must not be too close or too far.
4. Centering - face must be approximately centered in the frame.

If a check fails, the user is prompted with specific guidance and asked to retake the photo.

## Browser Compatibility

| Browser | Camera Capture | Face Detection |
|---------|---------------|----------------|
| Chrome (Android/Desktop) | Yes | Yes |
| Safari (iOS/Desktop) | Yes | Yes |
| WhatsApp in-app browser | Yes (via native camera) | Yes |
| Firefox | Yes | Yes |
| Samsung Internet | Yes | Yes |

> Note: In WhatsApp's in-app browser, the camera opens via the device's native camera app rather than an in-browser preview. Face quality checks run after the photo is taken.
