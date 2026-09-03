/**
 * Rope running over pulleys and onto drums.
 *
 * The point of these helpers is length bookkeeping: a rope is inextensible, so
 * whatever a drum takes up something else has to pay out. Getting that wrong is
 * how a linkage ends up drawn stretching and shrinking.
 */
import { bearing, polar, wrapTau, type Point } from './geometry';

/** Rope length taken up by a drum turning through an angle. */
export function drumTakeUp(radius: number, radians: number): number {
  return radius * Math.abs(radians);
}

/**
 * The arm and throw a lever needs in order to pay out exactly what a drum takes
 * up. Give both the same angle and this returns the same arm — a 1:1 linkage.
 */
export function matchingLeverArm(drumRadius: number, drumTravel: number, leverTravel: number): number {
  return (drumRadius * drumTravel) / leverTravel;
}

/** How far a rope wraps a drum, from where it lands to where it is made off. */
export function wrapSpan(centre: Point, tangent: Point, anchor: Point): number {
  return wrapTau(bearing(centre, anchor) - bearing(centre, tangent));
}

/** Rope lying on a drum between the tangent point and the anchor pin. */
export function wrappedLength(radius: number, centre: Point, tangent: Point, anchor: Point): number {
  return radius * wrapSpan(centre, tangent, anchor);
}

/** Free length of rope between a point and its tangent on a circle. */
export function freeLength(from: Point, centre: Point, radius: number): number {
  const d = Math.hypot(from.x - centre.x, from.y - centre.y);
  return Math.sqrt(Math.max(0, d * d - radius * radius));
}

/** A point on a drum that rotates with it. */
export function drumPin(centre: Point, radius: number, baseAngle: number, rotation: number): Point {
  return polar(centre, radius, baseAngle + rotation);
}
