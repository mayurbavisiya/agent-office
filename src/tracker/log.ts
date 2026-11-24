import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_LOG_BYTES = 1024 * 1024;

/** Appends to `<dir>/tracker.log`, rotating it to `tracker.log.1` once it reaches 1 MB. Never throws. */
export function makeLogger(dir: string): (...parts: unknown[]) => void {
  const file = join(dir, 'tracker.log');
  return (...parts) => {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        if (statSync(file).size >= MAX_LOG_BYTES) renameSync(file, `${file}.1`);
      } catch {
        // no log yet
      }
      appendFileSync(file, `${new Date().toISOString()} ${parts.map(String).join(' ')}\n`, { mode: 0o600 });
    } catch {
      // logging is best effort
    }
  };
}
