import { EventEmitter } from 'node:events';
import { open, stat } from 'node:fs/promises';
import { parseLogLine, type LogDelta } from './logParser.js';

const CHUNK = 64 * 1024;
/** A line longer than this is garbage: it is dropped (up to its newline) instead of buffered. */
const MAX_LINE = 1024 * 1024;

type Tail = {
  sessionId: string;
  agentId: string | null;
  path: string;
  offset: number;
  /** undefined until the first successful stat; then the offset starts at the then-current size (or 0 if the file appeared later) */
  initialised: boolean;
  startAtEnd: boolean;
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

  watch(sessionId: string, agentId: string | null, path: string): void {
    if (this.closed || this.tails.has(path)) return;
    this.tails.set(path, { sessionId, agentId, path, offset: 0, initialised: false, startAtEnd: true, leftover: '', skipping: false, busy: false });
    // Establish the starting offset right away so lines appended just after watch() are not lost.
    void this.poll(this.tails.get(path)!);
    this.timer ??= setInterval(() => {
      for (const t of this.tails.values()) void this.poll(t);
    }, this.intervalMs);
  }

  unwatch(path: string): void {
    this.tails.delete(path);
    if (this.tails.size === 0) this.stopTimer();
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
        // Missing now: if it shows up later, everything in it is new.
        if (!t.initialised) t.startAtEnd = false;
        return;
      }
      if (!t.initialised) {
        t.initialised = true;
        t.offset = t.startAtEnd ? size : 0;
      }
      if (size < t.offset) {
        t.offset = 0;
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
          this.consume(t, buf.toString('utf8', 0, bytesRead));
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
