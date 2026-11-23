import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.join(os.homedir(), '.agent-office');
const cfgPath = path.join(dir, 'config.json');
if (!fs.existsSync(cfgPath)) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cfg = { port: 47821, token: crypto.randomBytes(32).toString('hex') };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg), { mode: 0o600 });
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { port: number; token: string };

const outDir = path.resolve('tests/fixtures/hooks');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = path.join(outDir, `capture-${stamp}.jsonl`);

http
  .createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/event' || req.headers['x-agent-office-token'] !== cfg.token) {
      res.statusCode = 401;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8').replace(/\r?\n/g, ' ');
      fs.appendFileSync(outFile, body + '\n');
      res.statusCode = 204;
      res.end();
    });
  })
  .listen(cfg.port, '127.0.0.1', () => console.log(`capturing to ${outFile}`));
