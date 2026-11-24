// Headless tracker: the Agent Office server without Electron. Bundled to plugin/tracker/tracker.mjs.
import { rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp } from '../core/app.js';
import type { StartedBy } from '../server/eventServer.js';
import { shouldIdleExit } from './idle.js';
import { makeLogger } from './log.js';

declare const __VERSION__: string;
const version = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dir = process.env.AGENT_OFFICE_DIR || join(homedir(), '.agent-office');
const log = makeLogger(dir);
const startedBy: StartedBy = flag('started-by') === 'plugin' ? 'plugin' : 'app';
const idleMin = Number(flag('idle-exit-min') ?? 30);
const staticDir = join(dirname(fileURLToPath(import.meta.url)), 'scene');
const pidFile = join(dir, 'tracker.pid');

let app;
try {
  app = await startApp({ configDir: dir, staticDir, version, startedBy });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/in use/.test(msg)) process.exit(0); // another tracker (or the app) already serves this port
  log('startApp failed', msg);
  process.exit(1);
}
writeFileSync(pidFile, String(process.pid), { mode: 0o600 });
log(`tracker ${version} started by ${startedBy} at ${app.url}`);

let lastBusyAt = Date.now();
let stopping = false;
const stop = (why: string): void => {
  if (stopping) return;
  stopping = true;
  log('exiting:', why);
  try {
    rmSync(pidFile, { force: true });
  } catch {
    // ignore
  }
  void app.close().finally(() => process.exit(0));
};

if (startedBy === 'plugin' && Number.isFinite(idleMin) && idleMin > 0) {
  const timer = setInterval(() => {
    const now = Date.now();
    const sessions = Object.values(app.store.peek());
    if (app.clientCount() > 0 || sessions.some((s) => s.status !== 'ended')) lastBusyAt = now;
    else if (shouldIdleExit(now, lastBusyAt, idleMin)) stop(`idle for ${idleMin} min`);
  }, 60_000);
  timer.unref();
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
