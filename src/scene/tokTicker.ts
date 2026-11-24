// Name-tag token counters that count up smoothly when a new number lands, instead of jumping.
// Claude Code logs a step only once it finishes, so new numbers arrive every few seconds;
// the count-up and a short pulse make that read as live. Browser-only except the pure helpers.
import { formatTokens } from './panel.js';

export const TICK_MS = 900;
const SVGNS = 'http://www.w3.org/2000/svg';

/** Value shown `elapsed` ms into a count from `from` to `to` (ease-out cubic), whole tokens. */
export function tickValue(from: number, to: number, elapsed: number, dur = TICK_MS): number {
  if (elapsed >= dur || dur <= 0) return to;
  const t = Math.max(0, elapsed) / dur;
  return Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
}

/** "⚡ 12.3k tok" text for a value (undefined → "—"). */
export const tokLabel = (n: number | undefined) => `⚡ ${n === undefined ? '—' : formatTokens(n)} tok`;

/**
 * Writes "⚡ 12.3k tok" into the tag's text as two tspans (.bolt and .val) so CSS can blink the bolt
 * while the agent works. Untrusted text never reaches here: the label is built from numbers.
 */
export function writeTok(el: SVGTextElement, text: string): void {
  let bolt = el.querySelector<SVGTSpanElement>('tspan.bolt');
  let val = el.querySelector<SVGTSpanElement>('tspan.val');
  if (!bolt || !val) {
    el.textContent = '';
    bolt = document.createElementNS(SVGNS, 'tspan') as SVGTSpanElement;
    bolt.setAttribute('class', 'bolt');
    val = document.createElementNS(SVGNS, 'tspan') as SVGTSpanElement;
    val.setAttribute('class', 'val');
    el.append(bolt, val);
  }
  const i = text.indexOf(' ');
  const b = i < 0 ? '' : text.slice(0, i);
  const v = i < 0 ? text : text.slice(i);
  if (bolt.textContent !== b) bolt.textContent = b;
  if (val.textContent !== v) val.textContent = v;
}

type Tick = { shown: number; target: number; from: number; start: number; raf?: number };
const ticks = new WeakMap<SVGTextElement, Tick>();
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Points a tag's counter at `target`; counts up to it (or straight there under reduced motion). */
export function setTok(el: SVGTextElement, target: number | undefined): void {
  const cur = ticks.get(el);
  if (target === undefined) {
    if (cur?.raf) cancelAnimationFrame(cur.raf);
    ticks.delete(el);
    delete el.dataset.ticking;
    writeTok(el, tokLabel(undefined));
    return;
  }
  if (cur && cur.target === target) return;
  if (!cur || reduced() || typeof requestAnimationFrame !== 'function') {
    if (cur?.raf) cancelAnimationFrame(cur.raf);
    ticks.set(el, { shown: target, target, from: target, start: 0 });
    delete el.dataset.ticking;
    writeTok(el, tokLabel(target));
    return;
  }
  if (cur.raf) cancelAnimationFrame(cur.raf);
  const t: Tick = { shown: cur.shown, target, from: cur.shown, start: performance.now() };
  ticks.set(el, t);
  el.dataset.ticking = '1';
  el.classList.remove('bump');
  void el.getBoundingClientRect(); // restart the pulse
  el.classList.add('bump');
  const step = (now: number) => {
    if (ticks.get(el) !== t) return;
    t.shown = tickValue(t.from, t.target, now - t.start);
    writeTok(el, tokLabel(t.shown));
    if (t.shown === t.target) {
      t.raf = undefined;
      delete el.dataset.ticking;
      el.classList.remove('bump');
      return;
    }
    t.raf = requestAnimationFrame(step);
  };
  t.raf = requestAnimationFrame(step);
}
