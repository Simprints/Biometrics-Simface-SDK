# Contributing to SimFace SDK

Thanks for contributing to SimFace SDK.

## Local setup

```bash
npm install
npm run build
```

If you need the demo app as well:

```bash
cd demo
npm install
```

## Required checks

Please run the relevant checks before opening a pull request:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Pull request guidance

- Keep changes focused and explain any user-visible behavior changes.
- Add or update tests when behavior changes.
- Update `README.md` or `docs/` when public-facing setup, usage, or security guidance changes.
- Do not commit secrets, real API keys, or production project identifiers.
