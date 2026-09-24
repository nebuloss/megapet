/**
 * Geometry for the monitor's graph.
 *
 * Pure: it turns samples into path strings and knows nothing about elements,
 * which is what lets it be tested in the same node environment as the rest of
 * the maths in this project.
 *
 * The vertical axis is the **same logarithmic scale the dial uses**, from
 * `scale.ts`. That is not a detail: a linear axis sized for a gigabit link
 * draws a 20 Mbps connection flat against the floor, and a monitor you leave
 * running is exactly where a slow link needs to stay readable. It also means
 * the graph and the needle never disagree about where a reading sits.
 */
import { MAX_MBPS, MIN_MBPS, TICKS, toFraction } from './scale';
import type { SeriesPoint } from '../../engine/series';

export interface GraphView {
  readonly width: number;
  readonly height: number;
  /** Timestamps mapped to the left and right edges, in ms. */
  readonly fromMs: number;
  readonly toMs: number;
}

export type SeriesKey = 'down' | 'up';

/**
 * Strip along the bottom reserved for the time axis, in user units.
 *
 * It serves two purposes at once. A reading of zero would otherwise sit
 * exactly on the floor, where half its stroke falls outside the viewBox and a
 * switched-off direction draws a line you cannot see. And the time labels
 * need somewhere to live that is not on top of the lowest decade label, which
 * is what "1 Mbps" printed over "-10s" looked like.
 */
export const AXIS_GUTTER = 18;

/** Where a reading sits vertically. SVG counts downwards, the scale upwards. */
export function yFor(mbps: number, view: GraphView): number {
  // The scale is shortened from the bottom, not shifted down it: full scale
  // still lands on the top edge, and only the floor moves up.
  const usable = Math.max(0, view.height - AXIS_GUTTER);
  return usable - toFraction(mbps) * usable;
}

/** Where a timestamp sits horizontally. */
export function xFor(t: number, view: GraphView): number {
  const span = view.toMs - view.fromMs;
  if (!(span > 0)) return view.width;
  const fraction = (t - view.fromMs) / span;
  return Math.max(0, Math.min(1, fraction)) * view.width;
}

/**
 * The window to draw, given what has been collected.
 *
 * A young session draws into a window of `minSpanMs` anchored at its start, so
 * the line marches rightwards across a fixed axis. Rescaling to fit exactly
 * instead would redraw the axis under every new sample, and a graph whose
 * horizontal scale changes once a second is unreadable in the first seconds,
 * which is when someone is most likely to be watching it.
 *
 * Once the session outgrows that window the axis follows it, with the newest
 * sample on the right edge and the whole history to its left.
 */
/**
 * The samples that fall inside the window, plus one either side.
 *
 * Everything outside it is dropped rather than drawn: `xFor` clamps, so an
 * off-window point lands exactly on the frame, and a whole session's worth of
 * them piles up against the edge as a solid block of stroke. The neighbours
 * are kept so the line still enters and leaves the window at the right slope
 * instead of starting abruptly at the first visible sample.
 */
export function visible(
  points: readonly SeriesPoint[],
  view: GraphView,
): readonly SeriesPoint[] {
  if (points.length === 0) return points;
  let first = 0;
  while (first + 1 < points.length && points[first + 1]!.t < view.fromMs) first++;
  let last = points.length - 1;
  while (last > first && points[last - 1]!.t > view.toMs) last--;
  return first === 0 && last === points.length - 1 ? points : points.slice(first, last + 1);
}

/**
 * Whether a direction actually measured anything in these points.
 *
 * This, not "is that direction switched on right now", is what decides
 * whether a trace is drawn. The two are the same question only in manual
 * mode; in auto they are not, because the switches there follow the run's
 * *current phase* — so keying the trace off them erased the download history
 * the moment the run moved on to the upload leg.
 *
 * A direction that has never carried anything is all zeros, and drawing it
 * paints a line along the floor for a measurement nobody took. One that has
 * carried something keeps its trace for the rest of the session, including
 * the drop to zero when it stops: that drop is history too.
 */
export function hasData(points: readonly SeriesPoint[], key: SeriesKey): boolean {
  for (const point of points) {
    if (point[key] > 0) return true;
  }
  return false;
}

/** The line through one of the two series. Empty when there is nothing to draw. */
export function linePath(
  points: readonly SeriesPoint[],
  key: SeriesKey,
  view: GraphView,
): string {
  if (points.length === 0) return '';

  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of points) {
    xs.push(xFor(point.t, view));
    ys.push(yFor(point[key], view));
  }

  // A single sample is a point, not a line, and a bare moveto paints nothing.
  // Repeating it gives round caps something to render.
  if (xs.length === 1) {
    const only = `${xs[0]!.toFixed(2)} ${ys[0]!.toFixed(2)}`;
    return `M${only} L${only}`;
  }

  const slopes = monotoneSlopes(xs, ys);
  const steps: string[] = [`M${xs[0]!.toFixed(2)} ${ys[0]!.toFixed(2)}`];
  for (let i = 0; i + 1 < xs.length; i++) {
    const dx = xs[i + 1]! - xs[i]!;
    // Control points a third of the way along, which is what turns a Hermite
    // segment into the cubic Bezier SVG actually draws.
    const c1x = xs[i]! + dx / 3;
    const c1y = ys[i]! + (slopes[i]! * dx) / 3;
    const c2x = xs[i + 1]! - dx / 3;
    const c2y = ys[i + 1]! - (slopes[i + 1]! * dx) / 3;
    steps.push(
      `C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ` +
        `${xs[i + 1]!.toFixed(2)} ${ys[i + 1]!.toFixed(2)}`,
    );
  }
  return steps.join(' ');
}

/**
 * Tangents for a **monotone** cubic spline (Fritsch–Carlson).
 *
 * A plain Catmull-Rom or natural spline would be smoother still and would be
 * wrong: both overshoot around a sharp change, so a jump from idle to full
 * rate draws a dip below the floor before it and a hump above the peak after
 * it. On a throughput graph that is not a rendering artefact, it is a reading
 * — the curve would claim a speed that never happened, above the peak this
 * very panel reports. Limiting the tangents keeps every drawn value inside
 * the samples that produced it.
 */
function monotoneSlopes(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const deltas: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = xs[i + 1]! - xs[i]!;
    deltas.push(dx === 0 ? 0 : (ys[i + 1]! - ys[i]!) / dx);
  }

  const slopes: number[] = new Array(n).fill(0);
  slopes[0] = deltas[0] ?? 0;
  slopes[n - 1] = deltas[n - 2] ?? 0;
  for (let i = 1; i + 1 < n; i++) {
    const prev = deltas[i - 1]!;
    const next = deltas[i]!;
    // A local peak or trough gets a flat tangent, which is what stops the
    // curve sailing past it.
    slopes[i] = prev * next <= 0 ? 0 : (prev + next) / 2;
  }

  for (let i = 0; i + 1 < n; i++) {
    const delta = deltas[i]!;
    if (delta === 0) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const alpha = slopes[i]! / delta;
    const beta = slopes[i + 1]! / delta;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      slopes[i] = scale * alpha * delta;
      slopes[i + 1] = scale * beta * delta;
    }
  }
  return slopes;
}

/** The same line, closed down to the floor, for the tint under it. */
export function areaPath(
  points: readonly SeriesPoint[],
  key: SeriesKey,
  view: GraphView,
): string {
  if (points.length === 0) return '';
  const line = linePath(points, key, view);
  const firstX = xFor(points[0]!.t, view).toFixed(2);
  const lastX = xFor(points[points.length - 1]!.t, view).toFixed(2);
  const floor = view.height.toFixed(2);
  return `${line} L${lastX} ${floor} L${firstX} ${floor} Z`;
}

export interface GridLine {
  readonly y: number;
  readonly label: string;
  readonly mbps: number;
}

/** What the vertical graduations count in, printed once on the axis. */
export { UNIT } from './scale';

/**
 * One horizontal rule per decade, labelled.
 *
 * Only the decades inside the scale are emitted, and the topmost is dropped
 * when it would sit on the frame itself, where the label has nowhere to go.
 */
export function gridLines(view: GraphView): readonly GridLine[] {
  const lines: GridLine[] = [];
  for (const [mbps, label] of TICKS) {
    if (mbps < MIN_MBPS || mbps > MAX_MBPS) continue;
    const y = yFor(mbps, view);
    if (y < 8) continue;
    lines.push({ y, label, mbps });
  }
  return lines;
}

/** Candidate spacings for the time axis, in ms. */
const TIME_STEPS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
  3_600_000, 7_200_000, 21_600_000,
] as const;

export interface TimeTick {
  readonly x: number;
  readonly label: string;
}

/**
 * Ticks along the time axis, labelled as time **since the session began**.
 *
 * Counting up from zero rather than back from now: the numbers then name a
 * moment rather than describing a distance from a moving point, so a feature
 * keeps its label as the graph scrolls, two people can talk about "the dip at
 * 4:10", and an exported CSV — whose `elapsed_s` column counts the same way —
 * lines up with what was on screen.
 *
 * The spacing comes from a table of round intervals so the labels stay clear
 * of each other at any zoom, and the ticks land on multiples of that interval
 * so they do not slide about as the window moves.
 */
export function timeTicks(view: GraphView, _newestMs?: number, minGapPx = 90): readonly TimeTick[] {
  const span = view.toMs - view.fromMs;
  if (!(span > 0) || view.width <= 0) return [];

  const wanted = (span * minGapPx) / view.width;
  const step = TIME_STEPS.find((candidate) => candidate >= wanted) ?? TIME_STEPS[TIME_STEPS.length - 1]!;

  const ticks: TimeTick[] = [];
  const first = Math.ceil(view.fromMs / step) * step;
  for (let t = first; t <= view.toMs; t += step) {
    if (t < 0) continue;
    ticks.push({ x: xFor(t, view), label: formatElapsed(t) });
  }
  return ticks;
}

/** A coarse duration, for an axis that only needs the order of magnitude. */
export function formatSpan(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

/** Elapsed time for the readout, where the exact figure does matter. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Bytes as a human figure, for "transferred so far". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
