import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { personMarkup, stateClasses, setCheer, RIG } from '../src/scene/characters.js';
import { humanLook } from '../src/scene/looks.js';

describe('stateClasses', () => {
  it('seats a present character with its pose class', () => {
    expect(stateClasses('pose-type', null)).toEqual(['sitting', 'pose-type']);
    expect(stateClasses('pose-slump', null)).toEqual(['sitting', 'pose-slump']);
    expect(stateClasses('pose-lean', null)).toEqual(['sitting', 'pose-lean']);
    expect(stateClasses('pose-idle', null)).toEqual(['sitting', 'pose-idle']);
  });

  it('stands the boss up to wave when it needs you', () => {
    expect(stateClasses('pose-wave', null)).toEqual(['pose-wave']);
  });

  it('maps the animator pose overrides to walk/carry/cheer states', () => {
    expect(stateClasses('pose-type', 'walk')).toEqual(['walking']);
    expect(stateClasses('pose-type', 'carry')).toEqual(['walking', 'carrying']);
    expect(stateClasses('pose-type', 'wave')).toEqual(['cheer']);
    expect(stateClasses('pose-type', 'stand')).toEqual([]);
  });
});

describe('personMarkup', () => {
  const m = personMarkup(humanLook('a1', 'Explore'));
  const count = (re: RegExp) => (m.match(re) ?? []).length;

  it('builds the limb groups the animator relies on', () => {
    expect(m.startsWith('<g class="body"><g class="rig" transform="scale(1)">')).toBe(true);
    expect(personMarkup(humanLook('a1', 'Explore'), 'focus', 0.6)).toContain('transform="scale(0.6)"');
    expect(count(/class="limb leg front"/g)).toBe(1);
    expect(count(/class="limb leg back"/g)).toBe(1);
    expect(count(/class="shin"/g)).toBe(2);
    expect(count(/class="limb arm front"/g)).toBe(1);
    expect(count(/class="limb arm back"/g)).toBe(1);
    expect(count(/class="paper"/g)).toBe(1);
    // the paper sits in the front hand
    const front = m.slice(m.indexOf('class="limb arm front"'));
    expect(front.indexOf('class="paper"')).toBeGreaterThan(0);
  });

  it('wears the shirt colour and draws a tie only for the boss', () => {
    expect(m).toContain(humanLook('a1', 'Explore').shirt);
    expect(m).not.toContain('class="tie"');
    expect(personMarkup(humanLook('s1', 'boss'))).toContain('class="tie"');
  });

  it('stands about HEAD_TOP tall with feet at 0', () => {
    expect(RIG.leg + RIG.torso + RIG.head * 2).toBeGreaterThanOrEqual(56);
    expect(RIG.leg + RIG.torso + RIG.head * 2).toBeLessThanOrEqual(60);
  });
});

describe('handoff cheer and bust wave', () => {
  /** A g.char stub with real class bookkeeping (setCheer touches only dataset and classList). */
  function charStub() {
    const cls = new Set<string>();
    const g = {
      dataset: { pose: 'pose-type' } as Record<string, string>,
      classList: { add: (...n: string[]) => n.forEach((x) => cls.add(x)), remove: (...n: string[]) => n.forEach((x) => cls.delete(x)) },
    };
    return { g: g as unknown as SVGGElement, cls };
  }

  it('cheer is counted: overlapping celebrates keep the receiver waving until the last ends', () => {
    const { g, cls } = charStub();
    setCheer(g, true);
    setCheer(g, true);
    expect(cls.has('cheer')).toBe(true);
    setCheer(g, false);
    expect(cls.has('cheer')).toBe(true);
    setCheer(g, false);
    expect(cls.has('cheer')).toBe(false);
    expect(cls.has('sitting')).toBe(true);
    setCheer(g, false);
    expect(g.dataset.cheer).toBeUndefined();
  });

  it('the small bust wave outranks the full needs-you wave in styles.css', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/scene/styles.css', import.meta.url)), 'utf8');
    const ruleIndex = (sel: string) => css.split('\n').findIndex((l) => l.split('{')[0].split(',').some((s) => s.trim() === sel));
    // class / pseudo-class count (no ids or elements here); :not() adds only its argument's
    const spec = (sel: string) => (sel.replace(/:not\(/g, '(').match(/[.:]/g) ?? []).length;
    const full = '.char.pose-wave:not(.walking) .arm.front';
    const bust = [...css.matchAll(/^(\.char\.bust\.pose-wave[^{,]*\.arm\.front)\s*\{[^}]*rig-wave-bust/gm)].map((m) => m[1].trim());
    expect(ruleIndex(full)).toBeGreaterThanOrEqual(0);
    expect(bust).toHaveLength(1);
    const ok = spec(bust[0]) > spec(full) || (spec(bust[0]) === spec(full) && ruleIndex(bust[0]) > ruleIndex(full));
    expect(ok).toBe(true);
  });
});
