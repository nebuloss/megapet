/** Parts that connect one mechanism to another: springs and detents. */
import { clamp, distance, polar, TAU, type Point } from './geometry';

/**
 * Seats a spring pin on a rotating part so the spring stretches as much as
 * possible between two positions of that part.
 *
 * A spring is only useful as a return element if it is meaningfully longer at
 * one end of the travel than the other; seating the pin by eye tends to give a
 * spring that barely changes length and therefore barely pulls.
 */
export function seatSpringPin(
  pivot: Point,
  radius: number,
  anchor: Point,
  stretchedAt: number,
  relaxedAt: number,
  samples = 1440,
): number {
  let best = 0;
  let bestGain = -Infinity;
  for (let i = 0; i < samples; i++) {
    const base = (i / samples) * TAU;
    const gain =
      distance(polar(pivot, radius, base + stretchedAt), anchor) -
      distance(polar(pivot, radius, base + relaxedAt), anchor);
    if (gain > bestGain) {
      bestGain = gain;
      best = base;
    }
  }
  return best;
}

/** Length of a spring between a fixed anchor and a pin that rotates with a part. */
export function springLength(
  pivot: Point,
  radius: number,
  baseAngle: number,
  rotation: number,
  anchor: Point,
): number {
  return distance(polar(pivot, radius, baseAngle + rotation), anchor);
}

/**
 * How far a detent roller is pushed out of its notch.
 *
 * Zero in either seat, rising to the full lift in between. A detent is what
 * lets a rope go slack without the mechanism it holds wandering: only a pull
 * big enough to ride the roller out can move it.
 */
export function detentLift(position: number, seats: readonly number[], lift: number, width: number): number {
  const nearest = seats.reduce(
    (best, seat) => Math.min(best, Math.abs(position - seat)),
    Infinity,
  );
  return lift * clamp(nearest / width, 0, 1);
}
