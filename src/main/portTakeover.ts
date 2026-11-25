// The desktop app's start when its port is taken: a tracker the plugin started (`/office`) gives the
// port up on POST /shutdown, so the app stops it and starts once more. Anything else is left alone.
// No Electron imports, so vitest runs it against a real tracker.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

export type PortConfig = { port: number; token: string };
export type StartResult<T> = { app: T } | { error: string; inUse: boolean };
export type TakeoverOptions = {
  /** how long one request to the tracker may take */
  probeMs?: number;
  /** how long to wait for the port to free up after POST /shutdown */
  freeMs?: number;
  /** how often to check the port while waiting */
  pollMs?: number;
};

const HOST = '127.0.0.1';
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
export const isPortInUse = (msg: string): boolean => /EADDRINUSE|in use/i.test(msg);

/** Token-bearing request; never follows a redirect (fetch would carry the token header to the new host). */
async function request(cfg: PortConfig, path: string, method: 'GET' | 'POST', ms: number): Promise<Response | undefined> {
  try {
    return await fetch(`http://${HOST}:${cfg.port}${path}`, {
      method,
      headers: { 'X-Agent-Office-Token': cfg.token },
      redirect: 'error',
      signal: AbortSignal.timeout(ms),
    });
  } catch {
    return undefined;
  }
}

/**
 * Whether whatever holds the port is an Agent Office tracker that knows our token: `GET /hello` with
 * a fresh nonce must come back with sha256 of token + nonce. Checked before the token is ever sent.
 */
export async function provesToken(cfg: PortConfig, ms: number): Promise<boolean> {
  const nonce = randomBytes(18).toString('base64url');
  try {
    const r = await fetch(`http://${HOST}:${cfg.port}/hello?nonce=${nonce}`, { redirect: 'error', signal: AbortSignal.timeout(ms) });
    if (r.status !== 200) return false;
    const body = (await r.json()) as { proof?: unknown };
    return body.proof === createHash('sha256').update(`agent-office-proof:${cfg.token}:${nonce}`).digest('hex');
  } catch {
    return false;
  }
}

/** Whether `GET /state` says a tracker the plugin started holds the port. */
async function isPluginTracker(cfg: PortConfig, ms: number): Promise<boolean> {
  if (!(await provesToken(cfg, ms))) return false;
  const r = await request(cfg, '/state', 'GET', ms);
  if (!r || r.status !== 200) return false;
  try {
    const body = (await r.json()) as { startedBy?: unknown };
    return body.startedBy === 'plugin';
  } catch {
    return false;
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(false));
    s.listen(port, HOST, () => s.close(() => res(true)));
  });
}

async function waitForFree(port: number, ms: number, every: number): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await portFree(port)) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, every));
  }
}

/**
 * Runs `start`. On a port-in-use failure it asks the tracker on the port (`cfg()`, read only then)
 * for `/state`; when the plugin started it, it sends POST /shutdown, waits for the port and runs
 * `start` once more. Otherwise, or when that fails too, the error comes back with `inUse` set.
 */
export async function startOrTakeOver<T>(start: () => Promise<T>, cfg: () => PortConfig, opts: TakeoverOptions = {}): Promise<StartResult<T>> {
  const probeMs = opts.probeMs ?? 1000;
  const freeMs = opts.freeMs ?? 3000;
  const pollMs = opts.pollMs ?? 100;
  let first: string;
  try {
    return { app: await start() };
  } catch (err) {
    first = message(err);
  }
  if (!isPortInUse(first)) return { error: first, inUse: false };

  let c: PortConfig;
  try {
    c = cfg();
  } catch {
    return { error: first, inUse: true };
  }
  if (!(await isPluginTracker(c, probeMs))) return { error: first, inUse: true };
  const sent = await request(c, '/shutdown', 'POST', probeMs);
  if (!sent || sent.status < 200 || sent.status >= 300) return { error: first, inUse: true };
  if (!(await waitForFree(c.port, freeMs, pollMs))) return { error: first, inUse: true };
  try {
    return { app: await start() };
  } catch (err) {
    const again = message(err);
    return { error: again, inUse: isPortInUse(again) };
  }
}
