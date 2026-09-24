import { describe, expect, it } from 'vitest';
import {
  MAX_BELT_SPEED,
  MIN_BELT_SPEED,
  ROLLER_R,
  TREAD_GAP,
  beltSpeedFor,
  beltStep,
  bobPeriodMs,
  rollerAngle,
  treadOffsets,
} from './jog';
import { MAX_MBPS } from './scale';

describe('belt speed', () => {
  it('stands still when no session is running', () => {
    expect(beltSpeedFor(500, false)).toBe(0);
    expect(beltStep(500, false, 1000)).toBe(0);
  });

  it('creeps rather than freezing when the link is idle but the test is not', () => {
    expect(beltSpeedFor(0, true)).toBe(MIN_BELT_SPEED);
  });

  it('reaches full speed at the top of the scale', () => {
    expect(beltSpeedFor(MAX_MBPS, true)).toBeCloseTo(MAX_BELT_SPEED, 6);
  });

  /**
   * Geared to the log scale's fraction, not to the Mbps. A belt driven by the
   * raw figure would sit still across the whole useful range and then snap to
   * a blur near the top, which is the same mistake the dial's needle exists to
   * avoid.
   */
  it('separates the low decades instead of bunching them at a standstill', () => {
    const slow = beltSpeedFor(10, true);
    const mid = beltSpeedFor(100, true);
    const fast = beltSpeedFor(1000, true);
    expect(mid - slow).toBeCloseTo(fast - mid, 4);
  });

  it('never runs backwards, whatever it is handed', () => {
    for (const rate of [-50, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(beltSpeedFor(rate, true)).toBeGreaterThanOrEqual(0);
    }
  });

  it('scales travel with elapsed time', () => {
    expect(beltStep(100, true, 200)).toBeCloseTo(beltStep(100, true, 100) * 2, 6);
  });
});

describe('the rollers', () => {
  /**
   * The belt does not slip, so a roller turns by the arc it gives up. Deriving
   * it is what stops the two drifting apart, which looks wrong long before a
   * viewer can say why.
   */
  it('turns by the arc the belt has passed over it', () => {
    const quarter = (ROLLER_R * Math.PI) / 2;
    expect(rollerAngle(quarter)).toBeCloseTo(90, 4);
  });

  it('wraps rather than growing without bound', () => {
    expect(Math.abs(rollerAngle(1e6))).toBeLessThanOrEqual(360);
  });
});

describe('the tread', () => {
  it('covers the whole belt', () => {
    const offsets = treadOffsets(0, 68);
    expect(offsets[0]).toBeLessThanOrEqual(0);
    expect(offsets[offsets.length - 1]).toBeGreaterThanOrEqual(68 - TREAD_GAP);
  });

  it('keeps the same number of marks as it scrolls, so nothing flickers', () => {
    const counts = new Set<number>();
    for (let phase = 0; phase < TREAD_GAP * 4; phase += 0.7) {
      counts.add(treadOffsets(phase, 68).length);
    }
    // One mark may enter or leave at the edges; more than that is a pop.
    expect(counts.size).toBeLessThanOrEqual(2);
  });

  it('repeats every gap, so a long session cannot drift', () => {
    expect(treadOffsets(TREAD_GAP, 68)).toEqual(treadOffsets(TREAD_GAP * 9, 68));
  });

  it('handles a negative phase without losing its marks', () => {
    expect(treadOffsets(-5, 68).length).toBeGreaterThan(0);
  });
});

describe('his stride', () => {
  it('does not animate when nothing is running', () => {
    expect(bobPeriodMs(500, false)).toBe(0);
  });

  it('quickens as the link works harder', () => {
    expect(bobPeriodMs(1000, true)).toBeLessThan(bobPeriodMs(10, true));
  });

  // A stride faster than the eye resolves reads as a vibration, not a run.
  it('never becomes a blur', () => {
    expect(bobPeriodMs(MAX_MBPS, true)).toBeGreaterThanOrEqual(90);
  });
});
