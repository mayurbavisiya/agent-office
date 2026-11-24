// Bundles the headless tracker into plugin/tracker/tracker.mjs and copies the built scene next to it.
// `--out <dir>` writes the bundle elsewhere and `--scene <dir>` reads the built scene from elsewhere
// (the bundle test builds into a temp dir and compares it with the committed plugin/tracker).
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const out = resolve(arg('out') ?? join(root, 'plugin', 'tracker'));
const sceneSrc = resolve(arg('scene') ?? join(root, 'dist', 'scene'));
if (!existsSync(join(sceneSrc, 'index.html'))) throw new Error('dist/scene missing: run `npm run build:scene` first');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, 'src', 'tracker', 'main.ts')],
  outfile: join(out, 'tracker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  absWorkingDir: root,
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: { __VERSION__: JSON.stringify(version) },
  logLevel: 'info',
});
rmSync(join(out, 'scene'), { recursive: true, force: true });
// source maps are dev-only; keep the committed bundle small
cpSync(sceneSrc, join(out, 'scene'), { recursive: true, filter: (p) => !p.endsWith('.map') });
console.log(`plugin tracker built -> ${out}`);
