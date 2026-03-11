# SimFace SDK Development Guide

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | `22` | SDK and demo development |
| **npm** | bundled with Node | Dependency management |

## Repository setup

Install the SDK dependencies from the repository root:

```bash
npm install
```

Install the demo dependencies when you need to run or build the demo:

```bash
cd demo
npm install
```

## Running checks

### Frontend tests

```bash
npm test
```

For watch mode:

```bash
npm run test:watch
```

### Frontend type checking

```bash
npm run typecheck
```

### Frontend linting

```bash
npm run lint
```

## Building

### SDK

```bash
npm run build
```

This writes the distributable SDK files to `dist/`:

- `simface-sdk.js`
- `simface-sdk.umd.cjs`

### Demo app

The demo consumes the built SDK artifact from `dist/`, so build the SDK before starting or building the demo:

```bash
npm install
npm run build

cd demo
npm install
npm run dev
```

The demo runs at `http://localhost:4173` by default. To enable HTTPS (required for camera access from other devices on the local network), set `DEMO_USE_HTTPS=true` before starting the demo.

## Local demo workflow

1. Build the SDK at the repository root.
2. Start the separate backend service locally.
3. Start the demo from `demo/`.
4. Open `http://localhost:4173` (or `https://localhost:4173` if `DEMO_USE_HTTPS=true`), fill in `projectId`, `apiKey`, and `clientId`, then use Validate, Enroll, and Verify.

> Note: The demo expects a real backend, usually at `http://localhost:8080`.
>
> Note: The demo only stores the API URL, presentation mode, and client ID between reloads. It intentionally does not persist project IDs or API keys.
>
> Note: The SDK's face-quality checks fetch MediaPipe assets from public URLs, so the demo still needs internet access even when the backend is local.
>
> Note: On standard browsers, the SDK uses in-page camera capture with `getUserMedia()`. In WhatsApp, it falls back to the native camera/file-input capture path.

## CI/CD workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `copilot-setup-steps.yml` | Manual / changes to itself | Prepares the Copilot coding agent environment with Node.js plus frontend and demo dependencies |
| `test.yml` | PR to `main` / manual / workflow call | Runs SDK typecheck, tests, build, and demo build |
| `deploy.yml` | Manual | Reuses the test workflow, builds the SDK, and uploads the built artifact |
