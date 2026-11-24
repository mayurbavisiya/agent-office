// The floor: one room per session in a scrolling grid, diffed per room by session id. Browser-only.
import type { OfficeState, Session } from '../shared/types.js';
import { layoutRooms, ROOM_GAP, visibleSessions, type RoomLayout } from './layout.js';
import { layoutOf, renderRoom, updateRoom } from './rooms.js';

export class Floor {
  private readonly rooms = new Map<string, SVGGElement>();
  private last: OfficeState = { sessions: {} };
  /** ended sessions whose fade-out finished: off the floor while they stay ended */
  private readonly faded = new Set<string>();

  /** svg: the floor's root <svg> (sized in px); layer: the <g> rooms go into; viewport: the scrolling element. */
  constructor(
    private readonly svg: SVGSVGElement,
    private readonly layer: SVGGElement,
    private readonly viewport: HTMLElement,
  ) {}

  /**
   * Sessions in floor order: oldest room first, stable by id. The key is the store's floorSince (carried over
   * on a /clear takeover, so the successor gets the same slot and the shift change plays in place), else
   * boss.startedAt.
   */
  static order(state: OfficeState): Session[] {
    const key = (s: Session) => s.floorSince ?? s.boss.startedAt;
    return Object.values(state.sessions).sort((a, b) => key(a) - key(b) || (a.id < b.id ? -1 : 1));
  }

  get state(): OfficeState {
    return this.last;
  }

  /** Marks an ended room as faded out: the next render drops it (it returns if the session revives). */
  hideEnded(sessionId: string): void {
    if (this.last.sessions[sessionId]?.status === 'ended') this.faded.add(sessionId);
  }

  render(state: OfficeState = this.last): number {
    this.last = state;
    // revived (or pruned) sessions are no longer hidden
    for (const id of this.faded) if (state.sessions[id]?.status !== 'ended') this.faded.delete(id);
    // ended sessions without a room (already ended at load / reconnect) are never given one
    const sessions = visibleSessions(Floor.order(state), this.faded, new Set(this.rooms.keys()));
    const rects = layoutRooms(sessions.length, this.viewport.clientWidth, this.viewport.clientHeight);
    const seen = new Set<string>();
    sessions.forEach((s, i) => {
      seen.add(s.id);
      const existing = this.rooms.get(s.id);
      if (existing) updateRoom(existing, s, rects[i]);
      else {
        const g = renderRoom(s, rects[i]);
        this.rooms.set(s.id, g);
        this.layer.appendChild(g);
      }
    });
    for (const [id, g] of this.rooms)
      if (!seen.has(id)) {
        g.remove();
        this.rooms.delete(id);
      }
    const w = rects.reduce((m, r) => Math.max(m, r.x + r.w), 0) + ROOM_GAP;
    const h = rects.reduce((m, r) => Math.max(m, r.y + r.h), 0) + ROOM_GAP;
    this.svg.setAttribute('width', String(sessions.length ? w : 0));
    this.svg.setAttribute('height', String(sessions.length ? h : 0));
    return sessions.length;
  }

  roomEl(sessionId: string): SVGGElement | undefined {
    return this.rooms.get(sessionId);
  }

  /** agentId 'boss' selects the room's main agent. */
  characterEl(sessionId: string, agentId: string): SVGGElement | undefined {
    return this.rooms.get(sessionId)?.querySelector<SVGGElement>(`.people > [data-agent-id="${CSS.escape(agentId)}"]`) ?? undefined;
  }

  layoutOf(sessionId: string): RoomLayout | undefined {
    const g = this.rooms.get(sessionId);
    return g ? layoutOf(g) : undefined;
  }
}
