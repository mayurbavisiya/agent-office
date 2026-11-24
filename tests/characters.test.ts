import { describe, it, expect } from 'vitest';
import { personMarkup, stateClasses, RIG } from '../src/scene/characters.js';
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
