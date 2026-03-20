# Integration Test Fixtures

This directory contains face images used by the E2E integration tests that run
against the real SimFace backend.

## Current images

| File | Purpose |
|------|---------|
| `face-a.jpg` | **Placeholder** — solid-color image for transport-layer testing. |
| `face-b.jpg` | **Placeholder** — solid-color image for transport-layer testing. |

## Replacing with real face images

For full face-matching verification, replace these placeholders with real face
photographs. Requirements:

- JPEG format, ≥ 200×200 px
- Single face clearly visible, frontal pose
- `face-a.jpg` and `face-b.jpg` should be **different people** (to test no-match)
- Use images you have permission to use (e.g. your own photos or an open dataset
  like [LFW](http://vis-www.cs.umass.edu/lfw/) or
  [Generated Photos](https://generated.photos))

> **Note:** The backend may reject non-face images. If the integration tests
> fail with enrollment errors, that's the most likely cause — replace the
> placeholders with real face photos.
