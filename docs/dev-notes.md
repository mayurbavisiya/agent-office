# Dev notes

## Toolchain notes
Installed (latest at time of setup, 2026-11-23; Node v26.5.0, npm 11.17.0): typescript 7.0.2, vitest 5.1.1,
@types/node 26.6.6, @types/ws 8.18.2, esbuild 0.28.2, ws 8.23.0. package.json uses caret ranges; package-lock.json pins them.

esbuild has a postinstall script that this npm version blocks until approved (allow-scripts warning).
After a fresh `npm install`, run `npm approve-scripts esbuild` (non-interactive, works), then verify
with `npx esbuild --version` (expect 0.28.2). Later tasks that bundle with esbuild need this step.

## Demo mode / tsx
`tsx` is a dev dependency, used to run the TypeScript tools (`npm run serve`, `npm run demo`) because the sources use `.js` import suffixes.
`npm run serve` starts the app with `~/.agent-office/config.json` and prints the URL with `?token=`. `npm run demo -- [--speed 2] [--sessions 3] [--port N --token T]`
replays the hook fixtures as fake sessions over POST /event (fixed ~600 ms cadence, ~2500 ms before SubagentStop, both divided by speed) until Ctrl-C.
