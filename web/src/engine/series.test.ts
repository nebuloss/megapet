import { describe, expect, it } from 'vitest';
import { TimeSeries } from './series';

function fill(series: TimeSeries, count: number, at = (i: number) => i * 1000): void {
  for (let i = 0; i < count; i++) series.add({ t: at(i), down: i, up: i / 2 });
}

describe('TimeSeries', () => {
  it('keeps points until it is full', () => {
    const series = new TimeSeries(8);
    fill(series, 8);
    expect(series.length).toBe(8);
    expect(series.resolutionMs).toBe(1000);
  });

  // The whole reason this class exists: a test with no end must not grow a
  // buffer with no end either.
  it('never exceeds its capacity, however long it runs', () => {
    const series = new TimeSeries(8);
    fill(series, 5000);
    expect(series.length).toBeLessThanOrEqual(8);
  });

  it('halves its resolution each time it compacts', () => {
    const series = new TimeSeries(8);
    fill(series, 9);
    expect(series.resolutionMs).toBe(2000);
    fill(series, 100);
    expect(series.resolutionMs).toBeGreaterThan(2000);
  });

  it('still spans the whole session after compacting', () => {
    const series = new TimeSeries(8);
    fill(series, 64);
    expect(series.first?.t).toBe(0);
    expect(series.last?.t).toBeGreaterThan(60_000);
  });

  /**
   * Compaction must not walk the start of the session forward. Averaging the
   * two timestamps of a merged pair moves the oldest point half an interval
   * later every time, so a long session quietly loses its own beginning and
   * the axis understates how long it has been running.
   */
  it('keeps the beginning of the session pinned however often it compacts', () => {
    const series = new TimeSeries(8);
    fill(series, 4000);
    expect(series.first?.t).toBe(0);
  });

  it('keeps its points in order', () => {
    const series = new TimeSeries(8);
    fill(series, 500);
    const times = series.all.map((point) => point.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  /**
   * The trap this class is shaped around. Compaction averages adjacent pairs,
   * so a peak read back off the stored points decays every time the series
   * compacts — the longer you watched, the lower your recorded maximum would
   * get. Peaks come from the raw samples instead.
   */
  it('does not lose the peak when it compacts', () => {
    const series = new TimeSeries(8);
    series.add({ t: 0, down: 940, up: 0 });
    fill(series, 200, (i) => (i + 1) * 1000);
    expect(series.stats.peakDown).toBe(940);
  });

  it('counts every raw sample, not the points it kept', () => {
    const series = new TimeSeries(8);
    fill(series, 100);
    expect(series.stats.samples).toBe(100);
    expect(series.length).toBeLessThan(100);
  });

  it('treats a non-finite reading as zero rather than poisoning the graph', () => {
    const series = new TimeSeries(8);
    series.add({ t: 0, down: Number.NaN, up: Number.POSITIVE_INFINITY });
    expect(series.all[0]).toEqual({ t: 0, down: 0, up: 0 });
    expect(series.stats.peakDown).toBe(0);
  });

  it('never stores a negative rate', () => {
    const series = new TimeSeries(8);
    series.add({ t: 0, down: -5, up: -1 });
    expect(series.all[0]?.down).toBe(0);
  });

  it('forgets everything on clear', () => {
    const series = new TimeSeries(8);
    fill(series, 40);
    series.clear();
    expect(series.length).toBe(0);
    expect(series.stats).toEqual({ samples: 0, peakDown: 0, peakUp: 0 });
  });

  it('refuses a capacity too small to compact', () => {
    expect(() => new TimeSeries(2)).toThrow(RangeError);
  });
});
