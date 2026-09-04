import { describe, expect, it } from 'vitest';
import { gearOutline, springOutline } from './draw';
import { circularPitch, gear } from './gear';

const MODULE = 2.6;
const G = gear(MODULE, 15, 0, 0);

/** Splits a path into `[command, ...numbers]`, so a test can reason about it. */
function commands(path: string): Array<[string, number[]]> {
  return [...path.matchAll(/([MLAZ])([^MLAZ]*)/g)].map(([, letter, rest]) => [
    letter!,
    (rest!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number),
  ]);
}

/** Every point the pen is moved to, whichever command carried it. */
function points(path: string): Array<{ x: number; y: number }> {
  return commands(path)
    .filter(([letter]) => letter !== 'Z')
    .map(([, n]) => ({ x: n[n.length - 2]!, y: n[n.length - 1]! }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

describe('gearOutline', () => {
  const path = gearOutline(G, MODULE);
  const tip = G.radius + MODULE;
  const root = G.radius - 1.25 * MODULE;

  it('closes, so the tooth ring is a single filled region', () => {
    expect(path.startsWith('M ')).toBe(true);
    expect(path.trimEnd().endsWith('Z')).toBe(true);
  });

  it('cuts exactly one tooth per tooth count', () => {
    // One arc across the tip per tooth; the rest of the arcs run along the root.
    const tipArcs = commands(path).filter(([l, n]) => l === 'A' && Math.abs(n[0]! - tip) < 1e-9);
    expect(tipArcs).toHaveLength(G.teeth);
  });

  it('keeps every point between the root and the tip circle', () => {
    for (const p of points(path)) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeGreaterThanOrEqual(root - 0.02);
      expect(r).toBeLessThanOrEqual(tip + 0.02);
    }
  });

  it('gives the tooth an addendum of one module and a dedendum of 1.25', () => {
    // These are the proportions that let two gears mesh with clearance rather
    // than collide, so they are worth stating rather than leaving to the code.
    const radii = points(path).map((p) => Math.hypot(p.x, p.y));
    expect(Math.max(...radii)).toBeCloseTo(G.radius + MODULE, 1);
    expect(Math.min(...radii)).toBeCloseTo(G.radius - 1.25 * MODULE, 1);
  });

  it('makes the tooth half the circular pitch thick at the pitch circle', () => {
    const pitch = circularPitch(G);
    const onPitch = points(path).filter((p) => Math.abs(Math.hypot(p.x, p.y) - G.radius) < 0.02);
    expect(onPitch.length).toBe(2 * G.teeth);
    // The two flanks of the first tooth sit at ∓0.25 of the pitch about its centre.
    const a = Math.atan2(onPitch[0]!.y, onPitch[0]!.x);
    const b = Math.atan2(onPitch[1]!.y, onPitch[1]!.x);
    // Paths are emitted rounded to two decimals, so at this radius the angle
    // recovered from them carries about 2.6e-4 of error. Still four orders
    // inside the 0.1-of-a-pitch gap to the next plausible proportion.
    expect(Math.abs(b - a)).toBeCloseTo(0.5 * pitch, 3);
  });

  it('draws at the origin however the gear is placed, for the caller to translate', () => {
    // The signature takes a positioned gear but ignores its centre. That is a
    // trap worth pinning: the caller must wrap the result in a translate.
    expect(gearOutline(gear(MODULE, 15, 140, 100), MODULE)).toBe(path);
  });

  it('is detectably wrong when handed a module the gear was not cut to', () => {
    // Nothing stops this today. The teeth come out the wrong size for the gear's
    // own pitch radius, which is why the module belongs on the gear itself.
    const mismatched = gearOutline(G, MODULE * 1.5);
    const radii = points(mismatched).map((p) => Math.hypot(p.x, p.y));
    expect(Math.max(...radii)).toBeGreaterThan(G.radius + MODULE + 0.5);
  });
});

describe('springOutline', () => {
  const a = { x: 10, y: 20 };
  const b = { x: 60, y: 20 };
  const path = springOutline(a, b, {});

  it('starts on one eye and ends on the other', () => {
    const p = points(path);
    expect(p[0]!.x).toBeCloseTo(a.x, 2);
    expect(p[0]!.y).toBeCloseTo(a.y, 2);
    expect(p[p.length - 1]!.x).toBeCloseTo(b.x, 2);
    expect(p[p.length - 1]!.y).toBeCloseTo(b.y, 2);
  });

  it('lays down the coils it was asked for', () => {
    const coils = 5;
    const p = points(springOutline(a, b, { coils }));
    expect(p).toHaveLength(coils + 2); // the two eyes, and a point per coil
  });

  it('alternates the coils about the axis', () => {
    const p = points(springOutline(a, b, { coils: 6, amplitude: 4 }));
    const offsets = p.slice(1, -1).map((q) => q.y - a.y);
    for (let i = 1; i < offsets.length; i += 1) {
      expect(Math.sign(offsets[i]!)).toBe(-Math.sign(offsets[i - 1]!));
    }
    expect(Math.max(...offsets.map(Math.abs))).toBeCloseTo(4, 6);
  });

  it('survives coincident eyes rather than dividing by zero', () => {
    expect(() => springOutline(a, { ...a }, {})).not.toThrow();
    expect(springOutline(a, { ...a }, {})).not.toMatch(/NaN/);
  });
});
