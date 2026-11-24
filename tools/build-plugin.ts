// Bundles the headless tracker into plugin/tracker/tracker.mjs and copies the built scene next to it.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'plugin', 'tracker');
const sceneSrc = join(root, 'dist', 'scene');
if (!existsSync(join(sceneSrc, 'index.html'))) throw new Error('dist/scene missing: run `npm run build:scene` first');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, 'src', 'tracker', 'main.ts')],
  outfile: join(out, 'tracker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: { __VERSION__: JSON.stringify(version) },
  logLevel: 'info',
});
rmSync(join(out, 'scene'), { recursive: true, force: true });
// source maps are dev-only; keep the committed bundle small
cpSync(sceneSrc, join(out, 'scene'), { recursive: true, filter: (p) => !p.endsWith('.map') });
console.log(`plugin tracker built -> ${out}`);
