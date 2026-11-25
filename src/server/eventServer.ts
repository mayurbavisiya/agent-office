import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DAY_RE, localDay, totalTokens, type UsageSummary } from '../core/usage.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { OfficeStore } from '../core/store.js';
import type { HookEvent, OfficeEvent, ServerMessage } from '../shared/types.js';

const MAX_BODY = 1024 * 1024;
/** store changes within this window go out as one message (latest state, every event in order) */
export const BROADCAST_MS = 50;
const HOST = '127.0.0.1';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const digest = (s: string) => createHash('sha256').update(s).digest();
const tokenOk = (given: unknown, expected: string): boolean => typeof given === 'string' && timingSafeEqual(digest(given), digest(expected));

/**
 * The tracker's answer to `GET /hello?nonce=…`: proof that it knows the token, without sending it.
 * Clients check it before they send the token anywhere, so a stranger holding the port gets nothing.
 */
export const proofFor = (token: string, nonce: string): string => createHash('sha256').update(`agent-office-proof:${token}:${nonce}`).digest('hex');

/** A ticket from `POST /ticket` works once, for this long. */
export const TICKET_MS = 120_000;
const MAX_TICKETS = 16;
const MAX_KEYS = 32;

function reply(res: ServerResponse, status: number, body = '', headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export type StartedBy = 'plugin' | 'app' | 'serve';
export type EventServer = { url: string; clientCount(): number; close(): Promise<void> };

/** What the server needs from the usage ledger (src/core/usage.ts). */
export type UsageSource = { summary(from: string, to: string): UsageSummary; scanning: boolean };

export function startEventServer(opts: { port: number; token: string; store: OfficeStore; staticDir: string; version?: string; startedBy?: StartedBy; onShutdown?: () => void; usage?: UsageSource }): Promise<EventServer> {
  const { port, token, store } = opts;
  const version = opts.version ?? '0.0.0';
  const startedBy: StartedBy = opts.startedBy ?? 'app';
  /** bumped on every store change, whether or not a client is listening */
  let seq = 0;
  /** when this server started (ms since the epoch): with `version`, tells one tracker run from the next */
  const startedAt = Date.now();
  // One-time tickets (for links that may end up in a transcript) and the read-only keys they buy.
  // Both live in memory only: a restart voids them, so an old link or tab just asks for /office again.
  const tickets = new Map<string, number>();
  const keys: string[] = [];
  const readOk = (given: unknown): boolean => tokenOk(given, token) || (typeof given === 'string' && given.length > 0 && keys.some((k) => tokenOk(given, k)));
  const root = resolve(opts.staticDir);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  let boundPort = port;

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  let queued: OfficeEvent[] = [];
  let timer: NodeJS.Timeout | undefined;
  const flush = () => {
    timer = undefined;
    const events = queued;
    queued = [];
    if (clients.size === 0) return;
    const msg: ServerMessage = { type: 'events', events, state: store.snapshot() };
    for (const ws of clients) send(ws, msg);
  };
  store.onChange((events: OfficeEvent[]) => {
    seq++;
    if (clients.size === 0) return;
    queued.push(...events);
    timer ??= setTimeout(flush, BROADCAST_MS);
  });

  function handleEvent(req: IncomingMessage, res: ServerResponse): void {
    if (!tokenOk(req.headers['x-agent-office-token'], token)) {
      reply(res, 401, 'unauthorized');
      req.resume();
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY) {
      reply(res, 413, 'payload too large', { Connection: 'close' });
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (c: Buffer) => {
      if (rejected) return;
      size += c.length;
      if (size > MAX_BODY) {
        rejected = true;
        chunks.length = 0;
        reply(res, 413, 'payload too large', { Connection: 'close' });
        return;
      }
      chunks.push(c);
    });
    req.on('error', () => undefined);
    req.on('end', () => {
      if (rejected) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        reply(res, 400, 'malformed json');
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || typeof (parsed as HookEvent).session_id !== 'string') {
        reply(res, 400, 'not a hook event');
        return;
      }
      try {
        store.applyHook(parsed as HookEvent, Date.now());
      } catch {
        // the store never throws; a listener might. The hook was received either way.
      }
      reply(res, 204);
    });
  }

  /**
   * `GET /state` (token in `X-Agent-Office-Token`): `{ version, startedBy, startedAt, seq, state, usage? }`;
   * `usage.today` is today's cost and tokens across every session, once the first log read is done.
   * `seq` restarts at 0 with each run, so a reader keys "changed" on `version` + `startedAt` + `seq`.
   */
  function handleState(req: IncomingMessage, res: ServerResponse): void {
    if (!readOk(req.headers['x-agent-office-token'])) return reply(res, 401, 'unauthorized');
    const body: Record<string, unknown> = { version, startedBy, startedAt, seq, state: store.snapshot() };
    if (opts.usage && !opts.usage.scanning) {
      const day = localDay(Date.now());
      const t = opts.usage.summary(day, day).total;
      body.usage = { today: { cost: t.cost, tokens: totalTokens(t) } };
    }
    reply(res, 200, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  /**
   * `GET /usage?from=YYYY-MM-DD&to=YYYY-MM-DD` (token in `X-Agent-Office-Token`): token and cost totals
   * across every session for those local days, plus `scanning` while the first read of the logs runs.
   */
  function handleUsage(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (!readOk(req.headers['x-agent-office-token'])) return reply(res, 401, 'unauthorized');
    if (!opts.usage) return reply(res, 404, 'usage not available');
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return reply(res, 400, 'from and to must be YYYY-MM-DD, from <= to');
    reply(res, 200, JSON.stringify({ scanning: opts.usage.scanning, ...opts.usage.summary(from, to) }), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  /**
   * `POST /ticket` (token in `X-Agent-Office-Token`): `{ ticket }`, good once within TICKET_MS. `/office`
   * puts the ticket in its link instead of the token, so the copy left in the transcript is worthless.
   */
  function handleTicket(req: IncomingMessage, res: ServerResponse): void {
    req.resume();
    if (!tokenOk(req.headers['x-agent-office-token'], token)) return reply(res, 401, 'unauthorized');
    const now = Date.now();
    for (const [t, exp] of tickets) if (exp <= now) tickets.delete(t);
    while (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value!);
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, now + TICKET_MS);
    reply(res, 200, JSON.stringify({ ticket, expiresInMs: TICKET_MS }), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  }

  /**
   * `POST /redeem` with `{ "ticket": "…" }` from the office page itself: spends the ticket and answers
   * `{ key }`, a read-only key (state, usage, live updates; never /event, /shutdown or /ticket).
   * Only same-origin browser requests: a page on another site (or a rebinding DNS name) is refused.
   */
  function handleRedeem(req: IncomingMessage, res: ServerResponse): void {
    const host = req.headers.host ?? '';
    const own = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
    const origin = req.headers.origin;
    if (!own.includes(host) || (origin !== undefined && !own.some((h) => origin === `http://${h}`))) {
      req.resume();
      return reply(res, 403, 'forbidden');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= 1024) chunks.push(c);
    });
    req.on('error', () => undefined);
    req.on('end', () => {
      let ticket: unknown;
      try {
        ticket = size <= 1024 ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { ticket?: unknown }).ticket : undefined;
      } catch {
        ticket = undefined;
      }
      const exp = typeof ticket === 'string' ? tickets.get(ticket) : undefined;
      if (typeof ticket === 'string') tickets.delete(ticket);
      if (exp === undefined || exp <= Date.now()) return reply(res, 401, 'ticket expired or already used: run /office again');
      const key = randomBytes(32).toString('base64url');
      keys.push(key);
      if (keys.length > MAX_KEYS) keys.shift();
      reply(res, 200, JSON.stringify({ key }), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    });
  }

  /** `/office stop`: only a tracker the plugin started stops this way; the app quits from its menu. */
  function handleShutdown(req: IncomingMessage, res: ServerResponse): void {
    req.resume();
    if (!tokenOk(req.headers['x-agent-office-token'], token)) return reply(res, 401, 'unauthorized');
    if (startedBy !== 'plugin' || !opts.onShutdown) return reply(res, 409, `started by ${startedBy}`);
    const onShutdown = opts.onShutdown;
    res.once('finish', () => setImmediate(onShutdown));
    reply(res, 202);
  }

  async function handleStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return reply(res, 400, 'bad path');
    }
    if (rel.includes('\0')) return reply(res, 400, 'bad path');
    let file = resolve(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) return reply(res, 403, 'forbidden');
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const data = await readFile(file);
      reply(res, 200, req.method === 'HEAD' ? '' : (data as unknown as string), { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    } catch {
      reply(res, 404, 'not found');
    }
  }

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${HOST}`);
      if (url.pathname === '/event') {
        if (req.method !== 'POST') return reply(res, 405, 'method not allowed', { Allow: 'POST' });
        return handleEvent(req, res);
      }
      if (url.pathname === '/shutdown') {
        if (req.method !== 'POST') return reply(res, 405, 'method not allowed', { Allow: 'POST' });
        return handleShutdown(req, res);
      }
      if (url.pathname === '/ticket') {
        if (req.method !== 'POST') return reply(res, 405, 'method not allowed', { Allow: 'POST' });
        return handleTicket(req, res);
      }
      if (url.pathname === '/redeem') {
        if (req.method !== 'POST') return reply(res, 405, 'method not allowed', { Allow: 'POST' });
        return handleRedeem(req, res);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'method not allowed');
      if (url.pathname === '/hello') {
        const nonce = url.searchParams.get('nonce') ?? '';
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return reply(res, 400, 'nonce: 16-128 url-safe characters');
        return reply(res, 200, JSON.stringify({ app: 'agent-office', proof: proofFor(token, nonce) }), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      if (url.pathname === '/state') return handleState(req, res);
      if (url.pathname === '/usage') return handleUsage(req, res, url);
      void handleStatic(req, res, url.pathname);
    } catch {
      if (!res.headersSent) reply(res, 400, 'bad request');
    }
  });
  server.on('clientError', (_e, socket) => socket.destroy());

  server.on('upgrade', (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${HOST}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!readOk(url.searchParams.get('token'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
      send(ws, { type: 'snapshot', state: store.snapshot() });
    });
  });

  return new Promise((resolveStart, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'EADDRINUSE' ? new Error(`port ${port} in use`) : err);
    });
    server.listen(port, HOST, () => {
      server.removeAllListeners('error');
      server.on('error', () => undefined);
      const actual = (server.address() as { port: number }).port;
      boundPort = actual;
      resolveStart({
        url: `http://${HOST}:${actual}`,
        clientCount: () => clients.size,
        close: () =>
          new Promise<void>((done) => {
            if (timer) clearTimeout(timer);
            timer = undefined;
            queued = [];
            for (const ws of clients) ws.terminate();
            clients.clear();
            wss.close();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
