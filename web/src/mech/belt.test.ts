import { describe, expect, it } from 'vitest';
import { distance, TAU } from './geometry';
import {
  beltLength,
  beltRatio,
  contactAngle,
  crossingPoint,
  pulley,
  strandLength,
  strands,
} from './belt';

const drive = pulley(97.2, 115.6, 14);
const driven = pulley(140, 166, 14);

describe('beltRatio', () => {
  it('is the radius ratio, and reverses when crossed', () => {
    expect(beltRatio(drive, driven, false)).toBeCloseTo(1);
    expect(beltRatio(drive, driven, true)).toBeCloseTo(-1);
  });

  it('reverses without changing magnitude, so both directions travel alike', () => {
    const a = pulley(0, 0, 12);
    const b = pulley(60, 0, 16);
    expect(Math.abs(beltRatio(a, b, true))).toBeCloseTo(Math.abs(beltRatio(a, b, false)));
  });
});

describe('contactAngle', () => {
  it('is a quarter turn for an open belt on equal pulleys', () => {
    expect(contactAngle(drive, driven, false)).toBeCloseTo(Math.PI / 2);
  });

  it('closes up when the belt is crossed', () => {
    expect(contactAngle(drive, driven, true)).toBeLessThan(Math.PI / 2);
  });

  it('refuses pulleys too close to belt', () => {
    expect(() => contactAngle(pulley(0, 0, 20), pulley(10, 0, 20), true)).toThrow(RangeError);
  });
});

describe('strandLength', () => {
  it('is the centre distance for equal open pulleys', () => {
    expect(strandLength(drive, driven, false)).toBeCloseTo(distance(drive, driven));
  });

  it('is shorter when crossed, because the strands cut the corner', () => {
    expect(strandLength(drive, driven, true)).toBeLessThan(strandLength(drive, driven, false));
  });
});

describe('beltLength', () => {
  it('changes by only a few per cent between open and crossed', () => {
    const open = beltLength(drive, driven, false);
    const crossed = beltLength(drive, driven, true);
    // A real shifter walks the same belt across, so the two must be close.
    expect(Math.abs(crossed - open) / open).toBeLessThan(0.15);
  });
});

describe('strands', () => {
  it('lands on the pulleys at every point of the shift', () => {
    for (let i = 0; i <= 10; i++) {
      for (const s of strands(drive, driven, i / 10)) {
        expect(distance(drive, s.from)).toBeCloseTo(drive.radius);
        expect(distance(driven, s.to)).toBeCloseTo(driven.radius);
      }
    }
  });

  it('runs parallel when open', () => {
    const [a, b] = strands(drive, driven, 0);
    const da = Math.atan2(a.to.y - a.from.y, a.to.x - a.from.x);
    const db = Math.atan2(b.to.y - b.from.y, b.to.x - b.from.x);
    expect(Math.abs(da - db) % TAU).toBeCloseTo(0);
  });

  it('actually crosses when crossed', () => {
    const [a, b] = strands(drive, driven, 1);
    // Segments intersect iff each separates the other's endpoints.
    const side = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }): number =>
      Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    expect(side(a.from, a.to, b.from)).not.toBe(side(a.from, a.to, b.to));
    expect(side(b.from, b.to, a.from)).not.toBe(side(b.from, b.to, a.to));
  });

  it('moves continuously across the shift, never jumping', () => {
    let previous = strands(drive, driven, 0);
    for (let i = 1; i <= 100; i++) {
      const next = strands(drive, driven, i / 100);
      expect(distance(previous[0].to, next[0].to)).toBeLessThan(2);
      expect(distance(previous[1].to, next[1].to)).toBeLessThan(2);
      previous = next;
    }
  });
});

describe('crossingPoint', () => {
  it('sits midway between equal pulleys', () => {
    const p = crossingPoint(drive, driven);
    expect(distance(drive, p)).toBeCloseTo(distance(driven, p));
  });
});
