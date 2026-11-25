// The /office link carries a one-time ticket, never the token; the page trades it for a read-only key.
// Clients check /hello before they send the token anywhere.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createServer as createHttp } from 'node:http';
import WebSocket from 'ws';
import { OfficeStore } from '../src/core/store.js';
import { startEventServer, TICKET_MS } from '../src/server/eventServer.js';
import { provesToken } from '../src/main/portTakeover.js';

const TOKEN = 'tok-links';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  while (closers.length) await closers.pop()!();
});

function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

async function boot() {
  const port = await freePort();
  const srv = await startEventServer({ port, token: TOKEN, store: new OfficeStore(), staticDir: tmpdir() });
  closers.push(() => srv.close());
  return { port, base: `http://127.0.0.1:${port}` };
}

const ticket = async (base: string, token = TOKEN) =>
  fetch(`${base}/ticket`, { method: 'POST', headers: { 'X-Agent-Office-Token': token } });
const redeem = (base: string, t: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ticket: t }) });
const state = (base: string, key: string) => fetch(`${base}/state`, { headers: { 'X-Agent-Office-Token': key } });

describe('one-time link tickets', () => {
  it('a ticket needs the token, works once, and buys a read-only key', async () => {
    const { base } = await boot();
    expect((await ticket(base, 'wrong')).status).toBe(401);
    const t = ((await (await ticket(base)).json()) as { ticket: string }).ticket;
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const r = await redeem(base, t);
    expect(r.status).toBe(200);
    const key = ((await r.json()) as { key: string }).key;
    expect(key).not.toBe(TOKEN);
    expect((await redeem(base, t)).status).toBe(401); // spent

    // the key reads state, usage and the live socket ...
    expect((await state(base, key)).status).toBe(200);
    // ... but never writes events, mints tickets, or stops the tracker
    const asKey = { 'X-Agent-Office-Token': key };
    expect((await fetch(`${base}/event`, { method: 'POST', headers: asKey, body: '{"session_id":"x"}' })).status).toBe(401);
    expect((await fetch(`${base}/ticket`, { method: 'POST', headers: asKey })).status).toBe(401);
    expect((await fetch(`${base}/shutdown`, { method: 'POST', headers: asKey })).status).toBe(401);
  });

  it('the live socket accepts a key', async () => {
    const { base, port } = await boot();
    const t = ((await (await ticket(base)).json()) as { ticket: string }).ticket;
    const key = ((await (await redeem(base, t)).json()) as { key: string }).key;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(key)}`);
    const first = await new Promise<string>((res, rej) => {
      ws.once('message', (d) => res(String(d)));
      ws.once('error', rej);
    });
    ws.close();
    expect(JSON.parse(first).type).toBe('snapshot');
  });

  it('a ticket expires after TICKET_MS', async () => {
    const { base } = await boot();
    const t = ((await (await ticket(base)).json()) as { ticket: string }).ticket;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + TICKET_MS + 1);
    expect((await redeem(base, t)).status).toBe(401);
  });

  it('refuses unknown tickets, junk bodies, and other sites (Origin) or names (Host)', async () => {
    const { base, port } = await boot();
    expect((await redeem(base, 'made-up-ticket-0000000000')).status).toBe(401);
    expect((await fetch(`${base}/redeem`, { method: 'POST', body: 'not json' })).status).toBe(401);
    const t = ((await (await ticket(base)).json()) as { ticket: string }).ticket;
    expect((await redeem(base, t, { Origin: 'https://evil.example' })).status).toBe(403);
    // a rebinding DNS name points at 127.0.0.1 but the browser still sends its own Host
    const viaName = await new Promise<number>((res) => {
      import('node:http').then(({ request }) => {
        const r = request({ host: '127.0.0.1', port, path: '/redeem', method: 'POST', headers: { Host: `rebind.example:${port}`, 'Content-Type': 'application/json' } }, (resp) => {
          resp.resume();
          res(resp.statusCode ?? 0);
        });
        r.end(JSON.stringify({ ticket: t }));
      });
    });
    expect(viaName).toBe(403);
    // the refused attempts did not spend it
    expect((await redeem(base, t, { Origin: `http://127.0.0.1:${port}` })).status).toBe(200);
  });
});

describe('/hello: proving the token without sending it', () => {
  it('answers sha256 of the token and nonce, and the desktop app checks it', async () => {
    const { base, port } = await boot();
    const nonce = 'abcdefghijklmnop';
    const body = (await (await fetch(`${base}/hello?nonce=${nonce}`)).json()) as { app: string; proof: string };
    expect(body.app).toBe('agent-office');
    expect(body.proof).toBe(createHash('sha256').update(`agent-office-proof:${TOKEN}:${nonce}`).digest('hex'));
    expect((await fetch(`${base}/hello?nonce=short`)).status).toBe(400);
    expect(await provesToken({ port, token: TOKEN }, 1000)).toBe(true);
    expect(await provesToken({ port, token: 'other' }, 1000)).toBe(false);
  });

  it('the desktop app sends no token to a listener that cannot prove itself, and follows no redirect', async () => {
    const port = await freePort();
    const seen: Array<string | undefined> = [];
    const squatter = createHttp((req, res) => {
      seen.push(req.headers['x-agent-office-token'] as string | undefined);
      res.writeHead(307, { Location: 'http://localhost:1/steal' });
      res.end();
    });
    await new Promise<void>((res) => squatter.listen(port, '127.0.0.1', res));
    closers.push(() => new Promise<void>((res) => squatter.close(() => res())));
    expect(await provesToken({ port, token: TOKEN }, 1000)).toBe(false);
    expect(seen).toEqual([undefined]);
  });
});
