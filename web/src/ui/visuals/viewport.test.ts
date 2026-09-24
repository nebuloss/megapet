import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPAN_MS,
  GraphViewport,
  LEAD_POSITION,
  MAX_SPAN_MS,
  MIN_SPAN_MS,
} from './viewport';

/** Where a moment sits across the plot, 0..1, for the given window. */
function at(view: GraphViewport, t: number, newest: number): number {
  const { fromMs, toMs } = view.window(newest);
  return (t - fromMs) / (toMs - fromMs);
}

describe('zoom', () => {
  it('starts at a fixed, readable span rather than the whole session', () => {
    expect(new GraphViewport().spanMs).toBe(DEFAULT_SPAN_MS);
  });

  /**
   * The point of a default zoom: an hour-long session scrolls past at the
   * same precision it started with, instead of being squeezed into the width
   * until every feature is a pixel wide.
   */
  it('does not widen as the session grows', () => {
    const view = new GraphViewport();
    const early = view.window(20_000);
    const late = view.window(3_600_000);
    expect(late.toMs - late.fromMs).toBeCloseTo(early.toMs - early.fromMs, 6);
  });

  it('zooms out and in', () => {
    const view = new GraphViewport();
    view.zoom(2, 60_000);
    expect(view.spanMs).toBe(DEFAULT_SPAN_MS * 2);
    view.zoom(0.5, 60_000);
    expect(view.spanMs).toBe(DEFAULT_SPAN_MS);
  });

  it('refuses to zoom in past its limit', () => {
    const view = new GraphViewport();
    for (let i = 0; i < 40; i++) view.zoom(0.5, 60_000);
    expect(view.spanMs).toBe(MIN_SPAN_MS);
  });

  /**
   * Zooming out past the session's own start buys empty axis and shrinks the
   * only stretch there is anything to see in.
   */
  it('will not zoom out past the beginning of the session', () => {
    const view = new GraphViewport();
    for (let i = 0; i < 40; i++) view.zoom(2, 90_000);
    expect(view.spanMs).toBe(90_000);
  });

  it('still allows a readable window for a very short session', () => {
    const view = new GraphViewport();
    view.zoom(2, 3_000);
    expect(view.spanMs).toBe(MIN_SPAN_MS);
  });

  it('never exceeds the absolute ceiling, however long the session', () => {
    const view = new GraphViewport();
    for (let i = 0; i < 60; i++) view.zoom(2, 40 * 60 * 60 * 1000);
    expect(view.spanMs).toBe(MAX_SPAN_MS);
  });

  it('will not pan forward past the newest reading', () => {
    const view = new GraphViewport();
    view.pan(10_000_000, 120_000);
    expect(view.window(120_000).fromMs).toBeLessThanOrEqual(120_000);
  });

  /**
   * Zooming around a point keeps that point still. Without it the thing you
   * were looking at walks off the edge as you zoom, which makes examining a
   * feature nearly impossible.
   */
  it('keeps the point it is zoomed around still', () => {
    const view = new GraphViewport();
    view.pan(-10_000, 120_000);
    const before = at(view, 100_000, 120_000);
    view.zoom(2, 120_000, before);
    expect(at(view, 100_000, 120_000)).toBeCloseTo(before, 6);
  });
});

describe('focus', () => {
  it('follows the live edge by default', () => {
    expect(new GraphViewport().isFocused).toBe(true);
  });

  it('keeps the newest reading at a fixed place while following', () => {
    const view = new GraphViewport();
    expect(at(view, 60_000, 60_000)).toBeCloseTo(LEAD_POSITION, 6);
    expect(at(view, 600_000, 600_000)).toBeCloseTo(LEAD_POSITION, 6);
  });

  /**
   * Including before the session is a span old. Pinning the left edge at t=0
   * until it grows leaves "now" a third of the way across with a wide empty
   * stretch ahead of it, which reads as a graph that has stopped rather than
   * one that is still filling. Data scrolls in from the right instead.
   */
  it('anchors the newest reading even in the first seconds', () => {
    expect(at(new GraphViewport(), 3_000, 3_000)).toBeCloseTo(LEAD_POSITION, 6);
  });

  it('leaves clear air ahead of the newest reading', () => {
    expect(LEAD_POSITION).toBeLessThan(1);
    expect(at(new GraphViewport(), 60_000, 60_000)).toBeLessThan(1);
  });

  /**
   * A live chart that snapped back to "now" the moment you let go of a drag
   * would make looking at anything earlier impossible, so panning stops it
   * following.
   */
  it('stops following as soon as the graph is dragged', () => {
    const view = new GraphViewport();
    view.pan(-5_000, 60_000);
    expect(view.isFocused).toBe(false);
  });

  it('stays put once it has stopped following', () => {
    const view = new GraphViewport();
    view.pan(-20_000, 60_000);
    const parked = view.window(60_000);
    const later = view.window(600_000);
    expect(later).toEqual(parked);
  });

  it('returns to the live edge when switched back on', () => {
    const view = new GraphViewport();
    view.pan(-40_000, 120_000);
    view.setFocus(true);
    expect(at(view, 120_000, 120_000)).toBeCloseTo(LEAD_POSITION, 6);
  });

  /**
   * Focus and zoom are separate questions: "show me what is happening now"
   * and "show me more at once" should be answerable one at a time.
   */
  it('does not change the zoom', () => {
    const view = new GraphViewport();
    view.zoom(4, 60_000);
    const span = view.spanMs;
    view.setFocus(false);
    view.setFocus(true);
    expect(view.spanMs).toBe(span);
  });

  it('keeps following through a zoom', () => {
    const view = new GraphViewport();
    view.zoom(2, 60_000);
    expect(view.isFocused).toBe(true);
    expect(at(view, 60_000, 60_000)).toBeCloseTo(LEAD_POSITION, 6);
  });
});

describe('panning', () => {
  it('slides the window backwards in time', () => {
    const view = new GraphViewport();
    const before = view.window(120_000).fromMs;
    view.pan(-10_000, 120_000);
    expect(view.window(120_000).fromMs).toBeCloseTo(before - 10_000, 6);
  });

  it('will not scroll off the start of the session', () => {
    const view = new GraphViewport();
    view.pan(-10_000_000, 120_000);
    expect(view.window(120_000).fromMs).toBe(0);
  });

  it('fits the whole session when asked, and stops following', () => {
    const view = new GraphViewport();
    view.fit(0, 600_000);
    expect(view.spanMs).toBe(600_000);
    expect(view.isFocused).toBe(false);
  });

  it('goes back to the default view on reset', () => {
    const view = new GraphViewport();
    view.zoom(4, 60_000);
    view.pan(-30_000, 60_000);
    view.reset();
    expect(view.spanMs).toBe(DEFAULT_SPAN_MS);
    expect(view.isFocused).toBe(true);
  });
});
