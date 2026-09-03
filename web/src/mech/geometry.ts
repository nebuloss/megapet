/** Plane geometry shared by the mechanism modules. */

export const TAU = Math.PI * 2;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
export const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** Wraps an angle into [-pi, pi). */
export function wrapPi(angle: number): number {
  return ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** Wraps an angle into [0, 2pi). */
export function wrapTau(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

export function polar(centre: Point, radius: number, angle: number): Point {
  return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Angle of the line from `a` to `b`. */
export function bearing(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Where a straight line from `from` touches a circle. `side` picks which of the
 * two tangents: +1 for one, -1 for the other.
 */
export function tangentPoint(from: Point, centre: Point, radius: number, side: 1 | -1): Point {
  const d = distance(centre, from);
  if (d <= radius) throw new RangeError('tangentPoint: the point is inside the circle');
  return polar(centre, radius, bearing(centre, from) + side * Math.acos(radius / d));
}

/** Shortest distance from `p` to the segment `a`–`b`. */
export function segmentDistance(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(a, p);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0, 1);
  return distance({ x: a.x + t * dx, y: a.y + t * dy }, p);
}

/**
 * Bisects `f` for a root in [lo, hi]. Used to seat a mechanism by solving a
 * distance constraint rather than picking angles by eye.
 */
export function bisect(f: (x: number) => number, lo: number, hi: number, steps = 200): number {
  let a = lo;
  let b = hi;
  if (f(a) * f(b) > 0) throw new RangeError('bisect: the interval does not bracket a root');
  for (let i = 0; i < steps; i++) {
    const mid = (a + b) / 2;
    if (f(a) * f(mid) <= 0) b = mid;
    else a = mid;
  }
  return (a + b) / 2;
}

/**
 * Every root of `f` in [lo, hi], found by scanning for sign changes and then
 * bisecting each one.
 *
 * A single bisection over a wide interval silently fails when the interval
 * happens to contain two roots — the ends share a sign and it reports no root
 * at all. Seating a mechanism is exactly that case: a circle usually crosses a
 * constraint twice, and only one of the crossings is the one you want.
 */
export function findRoots(
  f: (x: number) => number,
  lo: number,
  hi: number,
  samples = 720,
): number[] {
  const roots: number[] = [];
  let previousX = lo;
  let previous = f(lo);
  if (previous === 0) roots.push(lo);

  for (let i = 1; i <= samples; i++) {
    const x = lo + ((hi - lo) * i) / samples;
    const current = f(x);
    if (current === 0) roots.push(x);
    else if (previous * current < 0) roots.push(bisect(f, previousX, x));
    previousX = x;
    previous = current;
  }
  return roots;
}
