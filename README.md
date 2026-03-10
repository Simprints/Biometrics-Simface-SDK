# SimFace SDK

SimFace SDK provides facial recognition for web-based KYC workflows. It is a drop-in Web Component and JavaScript API that handles camera capture, face quality validation, and communication with the SimFace backend.

Works in: all modern browsers, WhatsApp in-app browser, and mobile WebViews.

This repository is the public frontend SDK and demo repo for SimFace. For frontend architecture and contributor setup, see [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md).

The backend API, infrastructure, and TensorFlow Lite runtime live in the separate private backend repository.

The capture flow is planned explicitly as: auto camera -> manual camera -> media picker. Hosts can keep the default popup experience or opt into embedded capture with the same fallback policy.

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

## Capture strategy

The top-level SDK helpers accept an optional third `captureOptions` argument so the host can choose popup vs embedded capture and tune the fallback chain:

```javascript
import { enroll } from '@simprints/simface-sdk';

const result = await enroll(config, 'unique-user-id', {
  presentation: 'embedded',
  container: '#capture-slot',
  capturePreference: 'auto-preferred',
  allowMediaPickerFallback: true,
  label: 'Capture a face for enrollment',
  confirmLabel: 'Confirm enrollment capture',
});
```

Supported capture planning options:

- `presentation: 'popup' | 'embedded'`
- `capturePreference: 'auto-preferred' | 'manual-only'`
- `allowMediaPickerFallback: boolean`
- `container: HTMLElement | string` (required for top-level embedded capture)
- `label` / `confirmLabel`

## Web Component

For more control over the UI, use the `<simface-capture>` Web Component directly:

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
</script>
```

### Component Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `label` | String | `"Take a selfie"` | Instructional text shown on the capture button |
| `embedded` | Boolean | `false` | Runs the component inline instead of delegating to the popup capture service |
| `confirm-label` | String | `"Use this capture"` | Confirm button label used in preview state |
| `capture-preference` | `"auto-preferred" \| "manual-only"` | `"auto-preferred"` | Whether auto capture should be preferred or disabled |
| `allow-media-picker-fallback` | Boolean | `true` | Whether the component may fall back to the media picker if camera capture is unavailable |

### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `simface-captured` | `{ imageBlob: Blob }` | Fires when a quality-checked face image is confirmed |
| `simface-cancelled` | - | Fires when the user cancels the capture flow |
| `simface-error` | `{ error: string }` | Fires on capture/detection errors |

## API Reference

### `enroll(config, clientId, captureOptions?): Promise<EnrollResult>`

Opens the camera, captures a face image with quality validation, and enrolls the user.

Parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `SimFaceConfig` | SDK configuration (`apiUrl`, `projectId`, `apiKey`) |
| `clientId` | `string` | Unique identifier for the user |
| `captureOptions` | `SimFaceCaptureOptions` | Optional capture presentation/fallback overrides |

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
| `captureOptions` | `SimFaceCaptureOptions` | Optional capture presentation/fallback overrides |

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
