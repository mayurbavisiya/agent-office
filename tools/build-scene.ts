// Bundles the browser scene into dist/scene/ (main.js + index.html + styles.css), or `--out <dir>`.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'scene');
const i = process.argv.indexOf('--out');
const out = resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : join(root, 'dist', 'scene'));
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(src, 'main.ts')],
  outfile: join(out, 'main.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  absWorkingDir: root,
  logLevel: 'info',
});
for (const f of ['index.html', 'styles.css']) copyFileSync(join(src, f), join(out, f));
console.log(`scene built -> ${out}`);
