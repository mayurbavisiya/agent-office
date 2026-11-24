import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
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

function reply(res: ServerResponse, status: number, body = '', headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export type StartedBy = 'plugin' | 'app' | 'serve';
export type EventServer = { url: string; clientCount(): number; close(): Promise<void> };

export function startEventServer(opts: { port: number; token: string; store: OfficeStore; staticDir: string; version?: string; startedBy?: StartedBy }): Promise<EventServer> {
  const { port, token, store } = opts;
  const version = opts.version ?? '0.0.0';
  const startedBy: StartedBy = opts.startedBy ?? 'app';
  /** bumped on every store change, whether or not a client is listening */
  let seq = 0;
  const root = resolve(opts.staticDir);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

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

  function handleState(req: IncomingMessage, res: ServerResponse): void {
    if (!tokenOk(req.headers['x-agent-office-token'], token)) return reply(res, 401, 'unauthorized');
    reply(res, 200, JSON.stringify({ version, startedBy, seq, state: store.snapshot() }), { 'Content-Type': 'application/json; charset=utf-8' });
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
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'method not allowed');
      if (url.pathname === '/state') return handleState(req, res);
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
    if (!tokenOk(url.searchParams.get('token'), token)) {
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
