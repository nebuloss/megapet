import { describe, expect, it } from 'vitest';
import type { SeriesPoint } from '../../engine/series';
import {
  areaPath,
  hasData,
  formatBytes,
  formatElapsed,
  formatSpan,
  gridLines,
  linePath,
  timeTicks,
  xFor,
  yFor,
} from './graph';
import { MAX_MBPS } from './scale';

const VIEW = { width: 600, height: 200, fromMs: 0, toMs: 10_000 };

function points(...rates: number[]): SeriesPoint[] {
  return rates.map((down, i) => ({ t: i * 1000, down, up: down / 2 }));
}

describe('graph geometry', () => {
  it('puts a full-scale reading at the top', () => {
    expect(yFor(MAX_MBPS, VIEW)).toBeCloseTo(0, 6);
  });

  /**
   * A zero reading sitting exactly on the floor has half its stroke clipped by
   * the viewBox, so a direction that is switched off draws a line you cannot
   * see and the graph looks as though it has dropped it. It is held clear of
   * the edge instead.
   */
  it('keeps a zero line visible instead of clipping it against the edge', () => {
    const y = yFor(0, VIEW);
    expect(y).toBeLessThan(VIEW.height);
    expect(VIEW.height - y).toBeGreaterThanOrEqual(1.5);
  });

  // The scale bottoms out at MIN_MBPS, so 0 and 1 Mbps share the floor by
  // design; anything above it must sit higher.
  it('still puts zero below every reading the scale can separate', () => {
    expect(yFor(0, VIEW)).toBeGreaterThan(yFor(10, VIEW));
    expect(yFor(0, VIEW)).toBeGreaterThan(yFor(10_000, VIEW));
  });

  /**
   * The axis is logarithmic, like the dial. On a linear axis sized for a
   * gigabit link a 20 Mbps connection draws flat against the floor, which is
   * exactly the link you are most likely to leave a monitor running on.
   */
  it('gives each decade the same height', () => {
    const decade = yFor(10, VIEW) - yFor(100, VIEW);
    expect(yFor(100, VIEW) - yFor(1000, VIEW)).toBeCloseTo(decade, 6);
  });

  it('maps the time window across the width', () => {
    expect(xFor(0, VIEW)).toBeCloseTo(0, 6);
    expect(xFor(10_000, VIEW)).toBeCloseTo(600, 6);
    expect(xFor(5000, VIEW)).toBeCloseTo(300, 6);
  });

  it('clamps a sample outside the window rather than drawing off-canvas', () => {
    expect(xFor(-5000, VIEW)).toBe(0);
    expect(xFor(50_000, VIEW)).toBe(600);
  });

  it('draws nothing for an empty series', () => {
    expect(linePath([], 'down', VIEW)).toBe('');
    expect(areaPath([], 'down', VIEW)).toBe('');
  });

  // A bare moveto paints no pixels, so the first sample would be invisible
  // until the second arrived.
  it('draws a single sample as a visible dot', () => {
    const path = linePath(points(100), 'down', VIEW);
    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('L');
  });

  it('draws one curve per interval', () => {
    expect(linePath(points(10, 20, 30), 'down', VIEW).match(/C/g)?.length).toBe(2);
  });

  /**
   * The curve must not wander outside the samples that produced it. An
   * ordinary spline overshoots around a sharp change, which here would draw a
   * dip below the floor before a jump and a hump above the peak after it —
   * a speed that never happened, contradicting the peak this panel reports.
   */
  it('never draws a value the samples did not reach', () => {
    const sample = points(1, 1, 900, 900, 1, 1);
    const path = linePath(sample, 'down', VIEW);
    const ys = [...path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
    const top = yFor(900, VIEW);
    const floor = yFor(1, VIEW);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(top - 0.01);
    expect(Math.max(...ys)).toBeLessThanOrEqual(floor + 0.01);
  });

  it('flattens at a peak rather than sailing past it', () => {
    const rising = linePath(points(1, 10, 100, 100), 'down', VIEW);
    const ys = [...rising.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(yFor(100, VIEW) - 0.01);
  });

  it('closes the area down to the floor', () => {
    const path = areaPath(points(10, 20), 'down', VIEW);
    expect(path.endsWith('Z')).toBe(true);
    expect(path).toContain(VIEW.height.toFixed(2));
  });

  /**
   * Whether a trace is drawn follows the *data*, not whether that direction
   * is switched on now. In auto mode the switches track the run's current
   * phase, so keying the trace off them erased the download history the
   * moment the run moved on to the upload leg.
   */
  it('knows which directions actually measured something', () => {
    const oneWay = [
      { t: 0, down: 0, up: 0 },
      { t: 1000, down: 94, up: 0 },
    ];
    expect(hasData(oneWay, 'down')).toBe(true);
    expect(hasData(oneWay, 'up')).toBe(false);
  });

  it('still counts a direction that has since dropped back to zero', () => {
    const finished = [
      { t: 0, down: 94, up: 0 },
      { t: 1000, down: 0, up: 0 },
    ];
    expect(hasData(finished, 'down')).toBe(true);
  });

  it('has nothing to draw for an empty series', () => {
    expect(hasData([], 'down')).toBe(false);
  });

  it('reads the two series independently', () => {
    const sample = points(100);
    expect(linePath(sample, 'down', VIEW)).not.toBe(linePath(sample, 'up', VIEW));
  });
});

describe('the time axis', () => {
  const view = { width: 600, height: 200, fromMs: 0, toMs: 30_000 };

  /**
   * Counting up from the session's start, not back from now: a feature then
   * keeps its label as the graph scrolls, and the numbers match the
   * `elapsed_s` column of an exported CSV.
   */
  it('labels ticks by time since the session began', () => {
    const labels = timeTicks(view, 30_000).map((tick) => tick.label);
    expect(labels).toContain('0:00');
    expect(labels.every((label) => !label.startsWith('-'))).toBe(true);
  });

  it('keeps a label on a feature as the window scrolls past it', () => {
    const early = timeTicks({ ...view, fromMs: 0, toMs: 30_000 }, 30_000);
    const later = timeTicks({ ...view, fromMs: 10_000, toMs: 40_000 }, 40_000);
    const shared = early.filter((tick) => later.some((other) => other.label === tick.label));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('keeps the labels far enough apart to read at any zoom', () => {
    for (const span of [5_000, 30_000, 600_000, 7_200_000]) {
      const ticks = timeTicks({ ...view, toMs: span }, span);
      const xs = ticks.map((tick) => tick.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('stays inside the plot', () => {
    for (const tick of timeTicks(view, 30_000)) {
      expect(tick.x).toBeGreaterThanOrEqual(0);
      expect(tick.x).toBeLessThanOrEqual(view.width);
    }
  });

  it('has nothing to say about an empty window', () => {
    expect(timeTicks({ ...view, toMs: 0 }, 0)).toHaveLength(0);
  });
});

describe('grid', () => {
  it('rules one labelled line per decade inside the view', () => {
    const lines = gridLines(VIEW);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((line) => line.y >= 0 && line.y <= VIEW.height)).toBe(true);
    expect(lines.map((line) => line.label)).toContain('100');
  });
});

describe('formatting', () => {
  it('describes a span at the resolution a reader needs', () => {
    expect(formatSpan(45_000)).toBe('45s');
    expect(formatSpan(600_000)).toBe('10m');
    expect(formatSpan(7_200_000)).toBe('2h');
  });

  it('counts elapsed time exactly, and grows an hours field', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });

  it('scales bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1500)).toBe('1.5 kB');
    expect(formatBytes(4_200_000_000)).toBe('4.2 GB');
  });
});
