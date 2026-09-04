import { describe, expect, it } from 'vitest';
import { Pointer } from './pointer';
import { SWEEP_MS, toFraction } from './scale';

const F = 16;

/** Runs a pointer for `ms`, returning the largest single-frame move. */
function run(p: Pointer, ms: number): number {
  let worst = 0;
  for (let t = 0; t < ms; t += F) worst = Math.max(worst, Math.abs(p.update(F)));
  return worst;
}

describe('a pointer', () => {
  it('moves on the scale, not on the megabits', () => {
    // Easing the value and converting per frame swept it across 53% of the
    // dial in the first frame of every phase, because the scale is log.
    const p = new Pointer();
    p.aim(940);
    expect(Math.abs(p.update(F))).toBeLessThan(0.02);
  });

  it('travels at one speed, whatever the link is doing', () => {
    const fast = new Pointer();
    const slow = new Pointer();
    fast.aim(9500);
    slow.aim(60);
    const fastWorst = run(fast, 4000);
    const slowWorst = run(slow, 4000);
    const limit = F / SWEEP_MS;
    expect(fastWorst).toBeLessThanOrEqual(limit + 1e-9);
    expect(slowWorst).toBeCloseTo(fastWorst, 9);
  });

  it('takes longer to reach a further reading, rather than going faster', () => {
    const settleMs = (mbps: number): number => {
      const p = new Pointer();
      p.aim(mbps);
      let t = 0;
      while (!p.settled && t < 20000) {
        p.update(F);
        t += F;
      }
      return t;
    };
    const near = settleMs(60);
    const far = settleMs(9500);
    expect(far).toBeGreaterThan(near * 1.5);
  });

  it('swings back to the stop instead of dropping', () => {
    const p = new Pointer();
    p.aim(9500);
    run(p, 4000);
    p.aim(0);
    // An ease-in-out releases gently; the reading's own time constant moved it
    // 36 degrees of a 270 degree dial in the first frame.
    expect(Math.abs(p.update(F))).toBeLessThan(0.001);
    expect(p.falling).toBe(true);
  });

  it('arms the swing once, however often zero is re-sent', () => {
    const p = new Pointer();
    p.aim(9500);
    run(p, 4000);
    p.aim(0);
    run(p, 400);
    const partway = p.position;
    p.aim(0); // the reversing phase re-sends zero ten times a second
    p.aim(0);
    run(p, 400);
    expect(p.position).toBeLessThan(partway); // still falling, not restarted
  });

  it('cancels the swing when a real reading arrives', () => {
    const p = new Pointer();
    p.aim(9500);
    run(p, 4000);
    p.aim(0);
    run(p, 200);
    p.aim(500);
    expect(p.falling).toBe(false);
  });

  it('never lets the reading disagree with where it points', () => {
    // It cannot: the reading is read off the pointer rather than eased beside
    // it. Two values easing separately towards one reading do not agree on the
    // way — the number reached 96 Mbps while the pointer was still at 1.
    const p = new Pointer();
    p.aim(9500);
    for (let t = 0; t < 4000; t += F) {
      p.update(F);
      expect(toFraction(p.reading)).toBeCloseTo(p.position, 9);
    }
  });

  it('still tells the truth about a reading past the end of the dial', () => {
    const p = new Pointer();
    p.aim(25_000); // a link the scale cannot show
    for (let t = 0; t < 6000; t += F) p.update(F);
    expect(p.position).toBeCloseTo(1, 9); // pinned, approached asymptotically
    expect(p.reading).toBe(25_000);
  });

  it('hands its driver the distance it moved, once', () => {
    const p = new Pointer();
    p.aim(9500);
    const before = p.position;
    const delta = p.update(F);
    expect(delta).toBeCloseTo(p.position - before, 12);
    // Reading it again does not re-offer it.
    expect(p.delta).toBeCloseTo(delta, 12);
  });

  it('rests at the stop and settles where it was sent', () => {
    const p = new Pointer();
    p.aim(940);
    p.settle();
    expect(p.position).toBeCloseTo(toFraction(940), 12);
    // Derived through a log and back, so exact to about 1e-13 — far inside
    // what the readout rounds to before anyone sees it.
    expect(p.reading).toBeCloseTo(940, 9);
    p.rest();
    expect(p.position).toBe(0);
    expect(p.reading).toBe(0);
  });
});
