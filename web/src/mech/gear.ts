/**
 * Spur gears.
 *
 * Everything here is expressed in the terms a machinist would use: a common
 * module (pitch diameter divided by tooth count), tooth counts rather than
 * radii for the ratios, and a mesh condition that puts a tooth of one gear in
 * a space of the other.
 */
import { bearing, TAU, wrapPi, type Point } from './geometry';

export interface Gear extends Point {
  /** Number of teeth. Ratios are tooth counts, never radii. */
  readonly teeth: number;
  /** Pitch radius: teeth × module / 2. */
  readonly radius: number;
}

/** Pitch radius for a tooth count at a given module. */
export function pitchRadius(module: number, teeth: number): number {
  return (teeth * module) / 2;
}

export function gear(module: number, teeth: number, x: number, y: number): Gear {
  return { x, y, teeth, radius: pitchRadius(module, teeth) };
}

export function moveGear(g: Gear, x: number, y: number): Gear {
  return { ...g, x, y };
}

/** Centre distance at which two gears mesh. */
export function meshDistance(a: Gear, b: Gear): number {
  return a.radius + b.radius;
}

/** Ratio of driven to driver: negative, because meshed gears counter-rotate. */
export function meshRatio(driver: Gear, driven: Gear): number {
  return -driver.teeth / driven.teeth;
}

/**
 * How far the mesh is from correct, in radians of pitch. Zero when a tooth of
 * `a` sits in a space of `b` at the pitch point on their line of centres.
 */
export function meshError(a: Gear, phaseA: number, b: Gear, phaseB: number): number {
  const line = bearing(a, b);
  return wrapPi(a.teeth * (line - phaseA) + b.teeth * (line + Math.PI - phaseB) - Math.PI);
}

/** The phase `b` needs in order to mesh with `a`. */
export function meshPhase(a: Gear, phaseA: number, b: Gear): number {
  const line = bearing(a, b);
  return wrapPi((a.teeth * (line - phaseA) + b.teeth * (line + Math.PI) - Math.PI) / b.teeth);
}

/**
 * The smallest rotation of `b` that brings the pair into mesh. This is the
 * take-up a crash shift needs: engaging a stationary train lands tooth on
 * tooth, and something has to turn up to half a pitch to accept it.
 */
export function engagementTakeUp(a: Gear, phaseA: number, b: Gear, phaseB: number): number {
  return meshError(a, phaseA, b, phaseB) / b.teeth;
}

/** Half a tooth pitch on the pitch circle — the largest take-up possible. */
export function maxTakeUp(g: Gear): number {
  return Math.PI / g.teeth;
}

/**
 * A gear carried on an arm that pivots about the driver's axis stays in mesh at
 * every arm angle, and rolls around the driver as the arm moves. Both terms
 * matter: leaving the carrier out makes the planet slide instead of roll.
 */
export function planetPhase(
  driver: Gear,
  planet: Gear,
  driverPhase: number,
  carrierAngle: number,
  constant: number,
): number {
  const ratio = driver.teeth / planet.teeth;
  return (1 + ratio) * carrierAngle - ratio * driverPhase + constant;
}

/** Circular pitch: the arc between one tooth and the next. */
export function circularPitch(g: Gear): number {
  return TAU / g.teeth;
}
