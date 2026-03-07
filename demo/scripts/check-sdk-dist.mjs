import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkEntry = resolve(__dirname, '../../dist/simface-sdk.js');

try {
  await access(sdkEntry);
} catch {
  console.error('Missing built SDK artifact at dist/simface-sdk.js.');
  console.error('Run `npm install && npm run build` at the repo root before starting the demo module.');
  process.exit(1);
}
