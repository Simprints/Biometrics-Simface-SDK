## Project Overview
SimFace SDK — a web-based facial recognition SDK for KYC workflows. It captures face images via the browser camera, validates quality using MediaPipe, and communicates with a backend API for enrollment and verification.

## Tech Stack
- TypeScript
- Lit (web components)
- MediaPipe Tasks Vision (face detection/quality)
- Vite (build tooling)
- Vitest (testing)

## Demo Hosting
The `demo/` app is automatically deployed to **GitHub Pages** on every push to `main`.

Live URL: `https://simprints.github.io/LegoDay-Simprints-IDV-Frontend/`

> **One-time setup required:** In the GitHub repo go to **Settings → Pages → Build and deployment → Source** and set it to **"GitHub Actions"**. Without this, the `deploy-demo` workflow job will fail.

The `VITE_BASE_PATH` environment variable is set to `/LegoDay-Simprints-IDV-Frontend/` in CI so Vite produces correct asset URLs for the subpath. Local dev leaves this unset (defaults to `/`).

## Conventions
- **Language:** TypeScript
- Build: `npm run build` (tsc + vite)
- Test: `npm run test` (vitest)
- Lint: `npm run lint` (ESLint v9 flat config)
- Typecheck: `npm run typecheck` (tsc --noEmit)