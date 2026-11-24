// The usage bar across the top of the office: tokens and estimated cost across every Claude Code
// session for today, this week, this month or a custom range, from the tracker's GET /usage.
// Pure helpers first (tested), then the browser-only UsageBar.

export type RangeKind = 'today' | 'week' | 'month' | 'custom';
export type Range = { from: string; to: string };

export type Totals = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; unpricedTokens: number; requests: number };
export type UsageReply = {
  scanning: boolean;
  from: string;
  to: string;
  total: Totals;
  models: Record<string, Totals>;
  days: Array<{ day: string; total: Totals; models: Record<string, Totals> }>;
};

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day, "YYYY-MM-DD". */
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The days a range covers, in local time. Weeks start on Monday; custom ranges come back in order. */
export function rangeFor(kind: RangeKind, now: Date, custom?: Range): Range {
  const today = dayOf(now);
  if (kind === 'week') {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return { from: dayOf(monday), to: today };
  }
  if (kind === 'month') return { from: dayOf(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (kind === 'custom' && custom && /^\d{4}-\d{2}-\d{2}$/.test(custom.from) && /^\d{4}-\d{2}-\d{2}$/.test(custom.to)) {
    return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
  }
  return { from: today, to: today };
}

/** Token counts in millions where it matters: 3.35B, 509.1M, 2.97M, 48.2k, 950. */
export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e7) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** "$1,409.34"; "<$0.01" for a tiny non-zero amount. */
export function fmtUsd(n: number): string {
  if (n > 0 && n < 0.005) return '<$0.01';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const sumTokens = (t: Totals) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** "claude-opus-5-5" -> "Opus 5.5"; anything else as is. */
export function modelLabel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (!m) return id;
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

/** "Nov 24" for a day in the current year, "Nov 24, 2025" otherwise. */
export function dayLabel(day: string, now: Date): string {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, mo - 1, d);
  const s = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return y === now.getFullYear() ? s : `${s}, ${y}`;
}

/** What the bar shows for a reply. */
export function barText(r: UsageReply | null): { cost: string; tokens: string; written: string; cacheWrite: string; cacheRead: string; note: string } {
  if (!r) return { cost: '—', tokens: '—', written: '—', cacheWrite: '—', cacheRead: '—', note: '' };
  const t = r.total;
  const note = r.scanning ? 'reading logs…' : t.unpricedTokens > 0 ? `${fmtTokens(t.unpricedTokens)} tokens from unpriced models not in cost` : '';
  return { cost: `~${fmtUsd(t.cost)}`, tokens: fmtTokens(sumTokens(t)), written: fmtTokens(t.output), cacheWrite: fmtTokens(t.cacheWrite), cacheRead: fmtTokens(t.cacheRead), note };
}

// ---- browser-only ----

const RANGE_KEY = 'agentOffice.usageRange';
const POLL_MS = 30_000;

export class UsageBar {
  private kind: RangeKind = 'today';
  private custom: Range;
  private reply: UsageReply | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly details: HTMLElement,
    private readonly token: string,
  ) {
    const today = dayOf(new Date());
    this.custom = { from: today, to: today };
    try {
      const saved = JSON.parse(localStorage.getItem(RANGE_KEY) ?? 'null') as { kind?: RangeKind; custom?: Range } | null;
      if (saved?.kind && ['today', 'week', 'month', 'custom'].includes(saved.kind)) this.kind = saved.kind;
      if (saved?.custom) this.custom = rangeFor('custom', new Date(), saved.custom);
    } catch {
      /* storage unavailable: defaults */
    }
    el.addEventListener('click', (e) => {
      const t = e.target as Element;
      const b = t.closest<HTMLButtonElement>('[data-range]');
      if (b) return this.setKind(b.dataset.range as RangeKind);
      if (t.closest('#u-more')) this.toggleDetails();
    });
    for (const id of ['u-from', 'u-to']) {
      el.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener('change', () => {
        const from = el.querySelector<HTMLInputElement>('#u-from')!.value;
        const to = el.querySelector<HTMLInputElement>('#u-to')!.value;
        if (from && to) {
          this.custom = rangeFor('custom', new Date(), { from, to });
          this.remember();
          void this.load();
        }
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.load();
    });
    this.paintControls();
    void this.load();
  }

  private setKind(kind: RangeKind): void {
    this.kind = kind;
    this.remember();
    this.paintControls();
    void this.load();
  }

  private remember(): void {
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify({ kind: this.kind, custom: this.custom }));
    } catch {
      /* not saved: fine */
    }
  }

  private toggleDetails(): void {
    const open = this.details.hidden;
    this.details.hidden = !open;
    this.el.querySelector('#u-more')?.setAttribute('aria-expanded', String(open));
    if (open) this.paintDetails();
  }

  private paintControls(): void {
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-range]')) b.setAttribute('aria-pressed', String(b.dataset.range === this.kind));
    const box = this.el.querySelector<HTMLElement>('.u-custom');
    if (box) box.hidden = this.kind !== 'custom';
    const today = dayOf(new Date());
    const from = this.el.querySelector<HTMLInputElement>('#u-from');
    const to = this.el.querySelector<HTMLInputElement>('#u-to');
    if (from && to) {
      from.value = this.custom.from;
      to.value = this.custom.to;
      from.max = today;
      to.max = today;
    }
  }

  async load(): Promise<void> {
    clearTimeout(this.timer);
    const mine = ++this.seq;
    const r = rangeFor(this.kind, new Date(), this.custom);
    let next = POLL_MS;
    try {
      const res = await fetch(`/usage?from=${r.from}&to=${r.to}`, { headers: { 'X-Agent-Office-Token': this.token }, cache: 'no-store' });
      if (mine !== this.seq) return;
      if (res.ok) {
        this.reply = (await res.json()) as UsageReply;
        if (this.reply.scanning) next = 2000;
      } else {
        this.reply = null;
        this.el.hidden = res.status === 404; // an older tracker without /usage: no bar
      }
    } catch {
      if (mine !== this.seq) return;
      next = 5000;
    }
    this.paint();
    this.timer = setTimeout(() => void this.load(), next);
  }

  private paint(): void {
    const t = barText(this.reply);
    const set = (id: string, v: string) => {
      const n = this.el.querySelector(`#${id}`);
      if (n && n.textContent !== v) n.textContent = v;
    };
    set('u-cost', t.cost);
    set('u-tok', t.tokens);
    set('u-out', t.written);
    set('u-cw', t.cacheWrite);
    set('u-cr', t.cacheRead);
    set('u-note', t.note);
    if (!this.details.hidden) this.paintDetails();
  }

  /** The table: a row per day with its models beneath, like `ccusage`, and a total row. Built from numbers and model ids only. */
  private paintDetails(): void {
    const r = this.reply;
    const now = new Date();
    const doc = this.details.ownerDocument;
    const table = doc.createElement('table');
    const head = table.createTHead().insertRow();
    for (const h of ['Date', 'Input', 'Output', 'Cache write', 'Cache read', 'Total tokens', 'Est. cost']) {
      const th = doc.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    }
    const body = table.createTBody();
    const row = (label: string, t: Totals, cls: string) => {
      const tr = body.insertRow();
      tr.className = cls;
      for (const v of [label, fmtTokens(t.input), fmtTokens(t.output), fmtTokens(t.cacheWrite), fmtTokens(t.cacheRead), fmtTokens(sumTokens(t)), fmtUsd(t.cost)]) tr.insertCell().textContent = v;
    };
    for (const d of [...(r?.days ?? [])].reverse()) {
      row(dayLabel(d.day, now), d.total, 'u-day');
      for (const [m, t] of Object.entries(d.models).sort((a, b) => b[1].cost - a[1].cost)) row(modelLabel(m), t, 'u-model');
    }
    if (r && r.days.length) row('Total', r.total, 'u-total');
    const note = doc.createElement('p');
    note.className = 'u-fine';
    note.textContent = !r
      ? 'No usage data yet.'
      : r.days.length === 0
        ? 'No Claude Code usage in this range.'
        : 'Estimated at Anthropic API prices. On a Pro or Max plan you pay a flat subscription, so this is what the same usage would cost pay-per-token. Totals are saved daily to ~/.agent-office/usage.json, so they outlast Claude Code’s 30-day log cleanup.';
    this.details.replaceChildren(...(r && r.days.length ? [table] : []), note);
  }
}
