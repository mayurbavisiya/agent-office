import { EventEmitter } from 'node:events';
import { statSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { parseLogLine, type LogDelta } from './logParser.js';

const CHUNK = 64 * 1024;
/** A line longer than this is garbage: it is dropped (up to its newline) instead of buffered. */
const MAX_LINE = 1024 * 1024;

type Tail = {
  sessionId: string;
  agentId: string | null;
  path: string;
  offset: number;
  decoder: StringDecoder;
  leftover: string;
  skipping: boolean;
  busy: boolean;
};

/** Polls file sizes and emits parsed deltas for newly appended complete lines. Never throws on file errors. */
export class LogWatcher extends EventEmitter {
  private tails = new Map<string, Tail>();
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(private intervalMs = 1000) {
    super();
  }

  /** Default starts at EOF (only newly appended lines emit); `fromStart` replays existing content once. A missing file starts at 0. */
  watch(sessionId: string, agentId: string | null, path: string, opts?: { fromStart?: boolean }): void {
    if (this.closed || this.tails.has(path)) return;
    let offset = 0;
    if (!opts?.fromStart) {
      try {
        offset = statSync(path).size;
      } catch {
        offset = 0;
      }
    }
    const t: Tail = { sessionId, agentId, path, offset, decoder: new StringDecoder('utf8'), leftover: '', skipping: false, busy: false };
    this.tails.set(path, t);
    void this.poll(t);
    this.timer ??= setInterval(() => {
      for (const t of this.tails.values()) void this.poll(t);
    }, this.intervalMs);
  }

  unwatch(path: string): void {
    this.tails.delete(path);
    if (this.tails.size === 0) this.stopTimer();
  }

  /** Paths currently being tailed (for diagnostics and tests). */
  watchedPaths(): string[] {
    return [...this.tails.keys()];
  }

  close(): void {
    this.closed = true;
    this.tails.clear();
    this.stopTimer();
    this.removeAllListeners();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(t: Tail): Promise<void> {
    if (t.busy) return;
    t.busy = true;
    try {
      let size: number;
      try {
        size = (await stat(t.path)).size;
      } catch {
        return;
      }
      if (size < t.offset) {
        t.offset = 0;
        t.decoder = new StringDecoder('utf8');
        t.leftover = '';
        t.skipping = false;
      }
      if (size === t.offset) return;
      const fh = await open(t.path, 'r');
      try {
        const buf = Buffer.alloc(CHUNK);
        while (t.offset < size && this.tails.get(t.path) === t) {
          const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - t.offset), t.offset);
          if (bytesRead === 0) break;
          t.offset += bytesRead;
          this.consume(t, t.decoder.write(buf.subarray(0, bytesRead)));
        }
      } finally {
        await fh.close();
      }
    } catch {
      // unreadable: try again next poll
    } finally {
      t.busy = false;
    }
  }

  private consume(t: Tail, text: string): void {
    let start = 0;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl === -1) break;
      const piece = text.slice(start, nl);
      start = nl + 1;
      if (t.skipping) {
        t.skipping = false;
      } else {
        this.emitLine(t, t.leftover + piece);
      }
      t.leftover = '';
    }
    if (!t.skipping) {
      t.leftover += text.slice(start);
      if (t.leftover.length > MAX_LINE) {
        t.leftover = '';
        t.skipping = true;
      }
    }
  }

  private emitLine(t: Tail, line: string): void {
    if (line.length > MAX_LINE) return;
    const d: LogDelta | null = parseLogLine(line);
    if (!d) return;
    try {
      this.emit('delta', t.sessionId, t.agentId, d);
    } catch {
      // a listener error must not kill the watcher
    }
  }
}
