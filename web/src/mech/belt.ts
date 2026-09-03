/**
 * Belt drives.
 *
 * A belt between two pulleys runs them the same way when it is open and
 * opposite ways when it is crossed, which makes crossing it the simplest
 * reverser there is. Nothing meshes, so unlike a gear reverser there is no
 * engagement to get wrong and nothing that can be driven through anything else.
 */
import { bearing, distance, polar, TAU, wrapTau, type Point } from './geometry';

export interface Pulley extends Point {
  readonly radius: number;
}

export function pulley(x: number, y: number, radius: number): Pulley {
  return { x, y, radius };
}

/** Driven turns per driver turn. Negative when crossed, because it reverses. */
export function beltRatio(driver: Pulley, driven: Pulley, crossed: boolean): number {
  const magnitude = driver.radius / driven.radius;
  return crossed ? -magnitude : magnitude;
}

/**
 * Angle between the line of centres and the radius to a strand's contact
 * point. A quarter turn for an open belt on equal pulleys; less than that once
 * crossed, which is what tips the strands into an X.
 */
export function contactAngle(a: Pulley, b: Pulley, crossed: boolean): number {
  const span = distance(a, b);
  const reach = crossed ? a.radius + b.radius : a.radius - b.radius;
  if (Math.abs(reach) >= span) {
    throw new RangeError('contactAngle: the pulleys are too close to belt together');
  }
  return Math.acos(reach / span);
}

/** Free length of one strand between its two contact points. */
export function strandLength(a: Pulley, b: Pulley, crossed: boolean): number {
  const span = distance(a, b);
  const reach = crossed ? a.radius + b.radius : a.radius - b.radius;
  return Math.sqrt(span * span - reach * reach);
}

/** Total belt length: both strands plus the arc wrapped round each pulley. */
export function beltLength(a: Pulley, b: Pulley, crossed: boolean): number {
  const angle = contactAngle(a, b, crossed);
  const wrapA = crossed ? TAU - 2 * angle : Math.PI - 2 * angle + Math.PI;
  const wrapB = crossed ? TAU - 2 * angle : 2 * angle;
  return 2 * strandLength(a, b, crossed) + a.radius * wrapA + b.radius * wrapB;
}

export interface Strand {
  readonly from: Point;
  readonly to: Point;
}

/**
 * The two strands, as a pair of contact-point pairs.
 *
 * `cross` runs 0 to 1. At the ends these are the true open and crossed
 * tangents; in between the contact points walk round the pulleys, which is what
 * a belt does while a shifter fork is easing it across, and the caller draws it
 * slack to match.
 */
export function strands(a: Pulley, b: Pulley, cross: number): [Strand, Strand] {
  const line = bearing(a, b);
  const open = contactAngle(a, b, false);
  const closed = contactAngle(a, b, true);
  const angle = open + (closed - open) * cross;
  // Crossing swings each contact point on the driven pulley half a turn round.
  const flip = Math.PI * cross;

  const strand = (sign: 1 | -1): Strand => ({
    from: polar(a, a.radius, line + sign * angle),
    to: polar(b, b.radius, line + sign * angle + sign * flip),
  });
  return [strand(1), strand(-1)];
}

/** Where the strands cross, once they do. Undefined for an open belt. */
export function crossingPoint(a: Pulley, b: Pulley): Point {
  const t = a.radius / (a.radius + b.radius);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Arc a belt wraps around a pulley, from one contact point to the other. */
export function wrapArc(centre: Point, from: Point, to: Point): number {
  return wrapTau(bearing(centre, to) - bearing(centre, from));
}
