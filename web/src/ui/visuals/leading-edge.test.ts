import { describe, expect, it } from 'vitest';
import { LeadingEdge } from './leading-edge';
import { toFraction } from './scale';

/** Runs the edge for `ms` in 16ms frames and returns every value drawn. */
function play(edge: LeadingEdge, ms: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < ms; t += 16) out.push(edge.advance(16));
  return out;
}

describe('the graph\u2019s leading edge', () => {
  it('starts at the first reading rather than climbing up to it', () => {
    const edge = new LeadingEdge();
    edge.setTarget(500);
    // Easing up from zero would draw a ramp that never happened.
    expect(edge.current).toBeCloseTo(500, 0);
  });

  it('converges on the reading it is given', () => {
    const edge = new LeadingEdge();
    edge.setTarget(100);
    edge.advance(16);
    edge.setTarget(400);
    play(edge, 3000);
    expect(edge.current).toBeCloseTo(400, 0);
  });

  /**
   * The axis is logarithmic, so easing the Mbps and converting per frame makes
   * the line leap most of the way in its first frame and then crawl — the same
   * mistake the dial's needle exists to avoid. Easing the fraction gives a
   * move that looks the same speed at every scale.
   */
  it('eases the fraction, not the megabits', () => {
    const slow = new LeadingEdge();
    slow.setTarget(1);
    slow.advance(16);
    slow.setTarget(10);

    const fast = new LeadingEdge();
    fast.setTarget(100);
    fast.advance(16);
    fast.setTarget(1000);

    // Two jumps of one decade should cover the same share of the plot.
    const slowMoved = toFraction(slow.advance(100)) - toFraction(1);
    const fastMoved = toFraction(fast.advance(100)) - toFraction(100);
    expect(slowMoved).toBeCloseTo(fastMoved, 3);
  });

  it('never crosses the plot faster than its speed limit', () => {
    const edge = new LeadingEdge();
    edge.setTarget(1);
    edge.advance(16);
    edge.setTarget(10_000);
    const before = toFraction(edge.current);
    const after = toFraction(edge.advance(100));
    // A tenth of a second may not cover more than a tenth of the limit.
    expect(after - before).toBeLessThanOrEqual(0.035 + 1e-6);
  });

  it('moves every frame while it is still travelling', () => {
    const edge = new LeadingEdge();
    edge.setTarget(1);
    edge.advance(16);
    edge.setTarget(900);
    const frames = play(edge, 200);
    const stalled = frames.slice(1).filter((v, i) => v === frames[i]);
    expect(stalled).toHaveLength(0);
  });

  it('settles rather than oscillating around the target', () => {
    const edge = new LeadingEdge();
    edge.setTarget(50);
    edge.advance(16);
    edge.setTarget(200);
    play(edge, 4000);
    expect(edge.advance(16)).toBeCloseTo(200, 6);
  });

  it('comes back to the floor when it is reset', () => {
    const edge = new LeadingEdge();
    edge.setTarget(800);
    edge.reset();
    expect(edge.current).toBe(0);
  });

  it('treats a nonsense reading as nothing', () => {
    const edge = new LeadingEdge();
    edge.setTarget(Number.NaN);
    expect(Number.isFinite(edge.current)).toBe(true);
    edge.setTarget(-10);
    expect(edge.current).toBeGreaterThanOrEqual(0);
  });

  // A tab returning from the background reports a gap of minutes; without a
  // clamp the edge would jump the whole plot in a single frame.
  it('ignores an absurd frame gap', () => {
    const edge = new LeadingEdge();
    edge.setTarget(1);
    edge.advance(16);
    edge.setTarget(10_000);
    const before = toFraction(edge.current);
    const after = toFraction(edge.advance(600_000));
    expect(after - before).toBeLessThanOrEqual(0.09);
  });
});
