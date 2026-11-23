# Dev notes

## Toolchain notes
Installed (latest at time of setup, 2026-11-23; Node v26.5.0, npm 11.17.0): typescript 7.0.2, vitest 5.1.1,
@types/node 26.6.6, @types/ws 8.18.2, esbuild 0.28.2, ws 8.23.0. package.json uses caret ranges; package-lock.json pins them.

esbuild has a postinstall script that this npm version blocks until approved (allow-scripts warning).
After a fresh `npm install`, run `npm approve-scripts esbuild` (non-interactive, works), then verify
with `npx esbuild --version` (expect 0.28.2). Later tasks that bundle with esbuild need this step.
