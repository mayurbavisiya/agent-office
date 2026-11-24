/** True once the tracker has been continuously not-busy for `idleMin` minutes. */
export function shouldIdleExit(now: number, lastBusyAt: number, idleMin: number): boolean {
  return now - lastBusyAt >= idleMin * 60_000;
}
