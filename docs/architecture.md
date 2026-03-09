# SimFace SDK Architecture

## Overview

This repository contains the public frontend assets for SimFace:

- the browser SDK at the repository root,
- the local demo app in `demo/`, and
- the frontend-only automation and contributor docs.

The backend API, TensorFlow Lite model, and infrastructure code live in the separate private backend repository.

## Main components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| SDK entrypoint | `src/index.ts` | Exposes `enroll`, `verify`, `SimFaceAPIClient`, and the `simface-capture` Web Component |
| Capture UI | `src/components/` | Renders the Web Component flow for capture, preview, retry, and confirmation |
| Browser services | `src/services/` | Handles API requests, camera capture, and face-quality checks |
| Public types | `src/types/` | Defines the SDK request/response and event types |
| Demo app | `demo/` | Provides a local frontend that consumes the built SDK artifact from `dist/` |
| GitHub Actions | `.github/workflows/` | Runs frontend CI, artifact builds, and Copilot environment setup |

## Frontend request flow

### Enroll flow

1. A host application calls `enroll()` (optionally with capture options) or uses `<simface-capture>`.
2. The SDK validates the API key with the backend.
3. The SDK plans capture as an ordered strategy chain (auto camera -> manual camera -> media picker) based on presentation choice and runtime capabilities.
4. The SDK captures an image in the browser, runs client-side face-quality checks, and confirms the image with the user.
5. The SDK uploads the final image to the backend enrollment endpoint.
6. The backend returns the enrollment result to the host app.

### Verify flow

1. A host application calls `verify()` (optionally with capture options) or uses `SimFaceAPIClient` directly.
2. The SDK validates the API key with the backend.
3. The SDK plans capture as an ordered strategy chain (auto camera -> manual camera -> media picker) based on presentation choice and runtime capabilities.
4. The SDK captures a probe image and performs client-side quality checks.
5. The SDK uploads the probe image to the backend verification endpoint.
6. The backend returns the verification result to the host app.

## Capture constraints

- Hosts can choose popup or embedded capture; both presentations share the same ordered fallback policy.
- In standard browsers, the SDK prefers in-page camera capture through `getUserMedia()`.
- If realtime auto capture is unavailable, the SDK falls back to manual camera capture.
- If camera capture is unavailable or unsupported, the SDK can fall back to the media picker.
- Face-quality checks run in the browser before the image is submitted to the backend.

## Build artifacts

Running `npm run build` at the repo root produces:

- `dist/simface-sdk.js`
- `dist/simface-sdk.umd.cjs`

The demo intentionally consumes that built SDK output instead of importing source files directly.

## Repository layout

```text
├── src/                  SDK source code
├── demo/                 Local demo app wired to dist/
├── docs/                 Frontend architecture and development docs
├── .github/workflows/    Frontend CI/CD and Copilot setup
└── dist/                 Built SDK artifacts (generated)
```
