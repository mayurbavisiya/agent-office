import type { OfficeState, Session } from './types.js';

/** Shared "working" rule (compact strip and tray tooltip): a boss that is working or delegating, plus every
 * agent that is spawning, working or handing off. Ended sessions count 0. */
export function workingCount(s: Session): number {
  if (s.status === 'ended') return 0;
  let n = s.boss.status === 'working' || s.boss.status === 'delegating' ? 1 : 0;
  for (const a of Object.values(s.agents)) if (a.status === 'working' || a.status === 'spawning' || a.status === 'handing_off') n++;
  return n;
}

/** True when this session's lead is blocked on the person (permission prompt, question, waiting for input). */
export function needsYou(s: Session): boolean {
  return s.status !== 'ended' && s.boss.status === 'needs_you';
}

/** How many rooms are waiting on the person right now. */
export function waitingOnYou(state: OfficeState): number {
  return Object.values(state.sessions).filter(needsYou).length;
}

/** The page title: "(2) Agent Office" while rooms wait on the person, plain otherwise. */
export function officeTitle(waiting: number): string {
  return waiting > 0 ? `(${waiting}) Agent Office` : 'Agent Office';
}
