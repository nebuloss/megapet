/**
 * The history behind the monitor's graph.
 *
 * A continuous test has no end, so a series that simply appends grows until
 * the tab does. This keeps a bounded number of points by halving its own
 * resolution whenever it fills: adjacent pairs are averaged, the interval
 * between points doubles, and the whole session stays on screen. An hour and a
 * minute cost the same memory and the same number of path segments.
 *
 * The headline figures are deliberately **not** read back off those points.
 * Averaging pairs flattens spikes, so a peak computed from the graph would
 * quietly shrink every time the series compacted — the reading would get
 * slower the longer you watched. Peak, mean and totals are accumulated from
 * the raw samples as they arrive and are never compacted.
 */

/**
 * One sample.
 *
 * A direction that is switched off records zero rather than being absent: it
 * is carrying nothing, the line drops to the floor, and the graph shows the
 * shape of what was asked of the link. A gap would be more precise about the
 * difference between "off" and "stalled", but it reads as a rendering fault.
 */
export interface SeriesPoint {
  /** Milliseconds since the session began. */
  readonly t: number;
  readonly down: number;
  readonly up: number;
}

/**
 * Peaks only, deliberately.
 *
 * A mean of the samples would be a second, slightly different answer to a
 * question the meter already answers properly: it weights every sample equally
 * whatever it covers, and it includes the TCP ramp the grace period exists to
 * throw away. One average, from the meter.
 */
export interface SeriesStats {
  readonly samples: number;
  readonly peakDown: number;
  readonly peakUp: number;
}

const DEFAULT_CAPACITY = 600;

export class TimeSeries {
  private points: SeriesPoint[] = [];
  private interval: number;

  // Raw accumulators: never compacted, so the figures never decay.
  private count = 0;
  private began = new Date();
  private lastWrite = 0;
  private maxDown = 0;
  private maxUp = 0;

  /**
   * @param capacity Most points to keep. Compaction halves the count, so the
   *        series oscillates between `capacity / 2` and `capacity`.
   * @param intervalMs Expected spacing of incoming samples. Only used to
   *        report the current resolution; samples are not resampled onto it.
   */
  constructor(
    readonly capacity: number = DEFAULT_CAPACITY,
    intervalMs = 1000,
  ) {
    if (capacity < 4) throw new RangeError('TimeSeries: capacity must be at least 4');
    this.interval = intervalMs;
  }

  get length(): number {
    return this.points.length;
  }

  /**
   * Wall-clock time of the first sample, for exported timestamps.
   *
   * The series' own, because a series does not always belong to the thing
   * asking: a staged run's recording is exported through the same panel that
   * holds a manual session, and taking the session's start for it dated every
   * row wrongly.
   */
  get startedOn(): Date {
    return this.began;
  }

  /**
   * When this series last gained a sample, on the `performance.now` clock.
   *
   * Used to decide which of two histories is the current one: the monitor can
   * hold a session from earlier while the staged test has since recorded newer
   * runs, and "whichever was written to most recently" is the only ordering
   * that matches what the visitor just did.
   */
  get updatedAt(): number {
    return this.lastWrite;
  }

  /** Current spacing between stored points, which doubles on every compaction. */
  get resolutionMs(): number {
    return this.interval;
  }

  /** The points to draw. Borrowed, not copied: treat as read-only. */
  get all(): readonly SeriesPoint[] {
    return this.points;
  }

  get first(): SeriesPoint | undefined {
    return this.points[0];
  }

  get last(): SeriesPoint | undefined {
    return this.points[this.points.length - 1];
  }

  get stats(): SeriesStats {
    return { samples: this.count, peakDown: this.maxDown, peakUp: this.maxUp };
  }

  add(point: SeriesPoint): void {
    // A NaN would poison both the path and the peak, and there is no sensible
    // place on a graph to put one.
    const down = Number.isFinite(point.down) ? Math.max(0, point.down) : 0;
    const up = Number.isFinite(point.up) ? Math.max(0, point.up) : 0;

    if (this.points.length === 0) this.began = new Date();
    this.points.push({ t: point.t, down, up });
    this.count++;
    this.lastWrite = typeof performance === 'undefined' ? Date.now() : performance.now();
    if (down > this.maxDown) this.maxDown = down;
    if (up > this.maxUp) this.maxUp = up;

    if (this.points.length > this.capacity) this.compact();
  }

  clear(): void {
    this.points = [];
    this.count = 0;
    this.lastWrite = 0;
    this.maxDown = 0;
    this.maxUp = 0;
  }

  /**
   * Halves the resolution by averaging adjacent pairs.
   *
   * An odd trailing point is carried over untouched rather than averaged with
   * nothing, so it keeps its weight and gets merged on the next pass.
   */
  private compact(): void {
    const merged: SeriesPoint[] = [];
    let i = 0;
    for (; i + 1 < this.points.length; i += 2) {
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      merged.push({
        // The start of the span the average covers, never the midpoint.
        // Averaging the two timestamps looks more accurate and quietly eats
        // the session: the oldest point moves half an interval forward on
        // every compaction, so after an hour the graph has silently dropped
        // its own beginning and the axis lies about how long you have been
        // watching. Taking the earlier timestamp pins t=0 where it happened.
        t: a.t,
        down: (a.down + b.down) / 2,
        up: (a.up + b.up) / 2,
      });
    }
    if (i < this.points.length) merged.push(this.points[i]!);
    this.points = merged;
    this.interval *= 2;
  }
}
