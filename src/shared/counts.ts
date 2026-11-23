import type { Session } from './types.js';

/** Shared "working" rule (compact strip and tray tooltip): a boss that is working or delegating, plus every
 * agent that is spawning, working or handing off. Ended sessions count 0. */
export function workingCount(s: Session): number {
  if (s.status === 'ended') return 0;
  let n = s.boss.status === 'working' || s.boss.status === 'delegating' ? 1 : 0;
  for (const a of Object.values(s.agents)) if (a.status === 'working' || a.status === 'spawning' || a.status === 'handing_off') n++;
  return n;
}
