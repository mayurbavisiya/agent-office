// Bundles the Electron main process (dist/main/main.js, ESM) and the sandboxed preload (dist/main/preload.cjs).
import { build, type BuildOptions } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'main');
mkdirSync(out, { recursive: true });
const common: BuildOptions = { bundle: true, platform: 'node', target: 'node22', external: ['electron'], sourcemap: true, logLevel: 'info' };
await build({ ...common, entryPoints: [join(root, 'src', 'main', 'main.ts')], outfile: join(out, 'main.js'), format: 'esm', packages: 'external' });
await build({ ...common, entryPoints: [join(root, 'src', 'main', 'preload.ts')], outfile: join(out, 'preload.cjs'), format: 'cjs' });
console.log(`main built -> ${out}`);
