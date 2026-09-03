import { describe, expect, it } from 'vitest';
import { MAX_MBPS, MIN_MBPS, TICKS, toFraction } from './scale';

describe('toFraction', () => {
  it('gives every decade the same share of the dial', () => {
    // The defect this replaced: log10(1 + mbps) squashed the first decade into
    // 50 degrees of a 270 degree sweep while the last one got 67.5.
    const positions = TICKS.map(([value]) => toFraction(value));
    const gaps = positions.slice(1).map((p, i) => p - positions[i]!);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.25, 10);
  });

  it('puts the first graduation on the stop and the last at full scale', () => {
    expect(toFraction(MIN_MBPS)).toBe(0);
    expect(toFraction(MAX_MBPS)).toBe(1);
  });

  it('pins anything below the bottom of the scale, including zero', () => {
    expect(toFraction(0)).toBe(0);
    expect(toFraction(0.4)).toBe(0);
    expect(toFraction(-5)).toBe(0);
    expect(toFraction(Number.NaN)).toBe(0);
  });

  it('clamps above full scale rather than running off the dial', () => {
    expect(toFraction(25_000)).toBe(1);
    expect(toFraction(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('rises monotonically across the whole range', () => {
    let previous = -1;
    for (let mbps = 1; mbps <= MAX_MBPS; mbps *= 1.2) {
      const f = toFraction(mbps);
      expect(f).toBeGreaterThanOrEqual(previous);
      previous = f;
    }
  });

  it('places a midpoint of a decade halfway along it', () => {
    // sqrt(10) is the geometric middle of 1..10, so it sits at an eighth.
    expect(toFraction(Math.sqrt(10))).toBeCloseTo(0.125, 10);
  });
});
