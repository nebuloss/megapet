/**
 * A tumbler reverse: the gear train a lathe uses to reverse its leadscrew.
 *
 *   hub      the input, on the driving shaft
 *   swing    carried on a yoke that pivots about the hub's own axis, so it
 *            stays meshed with the hub wherever the yoke is
 *   output   the thing being driven
 *   reverse  fixed, permanently meshed with the output
 *
 * Rock the yoke one way and the swing gear meets the output directly: two
 * meshes, so the output turns with the hub's sign reversed once. Rock it the
 * other and the swing gear meets the reverse gear instead: three meshes, and
 * the output turns the other way. The intermediate gears only set direction —
 * their tooth counts cancel out of the overall ratio.
 */
import { distance, findRoots, polar, toDegrees, toRadians, type Point } from './geometry';
import {
  engagementTakeUp,
  gear,
  meshDistance,
  meshPhase,
  planetPhase,
  type Gear,
} from './gear';

export type Seat = 'direct' | 'reversed';

export interface TumblerSpec {
  module: number;
  hub: { teeth: number; at: Point };
  output: { teeth: number; at: Point };
  swing: { teeth: number };
  /** Only the x of the reverse gear is chosen; y follows from its mesh. */
  reverse: { teeth: number; x: number; above: boolean };
}

export interface Tumbler {
  readonly module: number;
  readonly hub: Gear;
  readonly output: Gear;
  readonly reverse: Gear;
  /** The swing gear at the yoke's zero position (straight "down" from the hub). */
  readonly swing: Gear;
  /** Distance from the yoke pivot to the swing gear's centre. */
  readonly arm: number;
  /** Yoke angles, in degrees, at which each seat meshes exactly. */
  readonly seats: Readonly<Record<Seat, number>>;
  /** Constant tooth phases, solved once so every mesh indexes correctly. */
  readonly swingPhaseConstant: number;
  readonly reversePhaseConstant: number;
}

/** Swing-gear centre for a yoke angle, in degrees. */
export function swingCentre(t: Tumbler, yokeDegrees: number): Gear {
  const p = polar(t.hub, t.arm, Math.PI / 2 + toRadians(yokeDegrees));
  return { ...t.swing, x: p.x, y: p.y };
}

/**
 * Builds the train and solves both yoke seats from the mesh distances, rather
 * than leaving them to be guessed. Throws if the layout cannot mesh at all,
 * which is the useful failure: it means the centres are too far apart.
 */
export function buildTumbler(spec: TumblerSpec): Tumbler {
  const m = spec.module;
  const hub = gear(m, spec.hub.teeth, spec.hub.at.x, spec.hub.at.y);
  const output = gear(m, spec.output.teeth, spec.output.at.x, spec.output.at.y);
  const swingSeed = gear(m, spec.swing.teeth, 0, 0);

  // Seat the reverse gear at exactly one mesh distance from the output.
  const reverseSeed = gear(m, spec.reverse.teeth, spec.reverse.x, 0);
  const span = meshDistance(reverseSeed, output);
  const dx = spec.reverse.x - output.x;
  if (Math.abs(dx) > span) {
    throw new RangeError('buildTumbler: the reverse gear cannot reach the output');
  }
  const dy = Math.sqrt(span * span - dx * dx);
  const reverse: Gear = { ...reverseSeed, y: output.y + (spec.reverse.above ? -dy : dy) };

  const arm = meshDistance(hub, swingSeed);
  const partial: Tumbler = {
    module: m,
    hub,
    output,
    reverse,
    swing: swingSeed,
    arm,
    seats: { direct: 0, reversed: 0 },
    swingPhaseConstant: 0,
    reversePhaseConstant: 0,
  };

  /**
   * Seats the yoke by solving the mesh distance to `target`.
   *
   * The swing gear's circle crosses that constraint more than once, and the
   * near crossing usually drives the swing gear straight into the gear it is
   * supposed to be clear of. So take every root on the given side and keep the
   * one that leaves the disengaged gear furthest away.
   */
  const seatFor = (target: Gear, other: Gear, lo: number, hi: number): number => {
    const need = meshDistance(swingSeed, target);
    const roots = findRoots((deg) => distance(swingCentre(partial, deg), target) - need, lo, hi);
    if (roots.length === 0) {
      throw new RangeError('buildTumbler: the swing gear cannot reach a seat on this side');
    }
    // Tips touch once the centres are closer than this.
    const foul = meshDistance(swingSeed, other) - 2 * m;
    const clearance = (deg: number): number => distance(swingCentre(partial, deg), other);
    const best = roots.reduce((a, b) => (clearance(b) > clearance(a) ? b : a));
    if (clearance(best) <= foul) {
      throw new RangeError('buildTumbler: every seat fouls the disengaged gear');
    }
    return best;
  };

  const seats = {
    direct: seatFor(output, reverse, 0, 180),
    reversed: seatFor(reverse, output, -180, 0),
  } as const;

  // Reference pose: hub and output unrotated, yoke at zero.
  const swingPhaseConstant = meshPhase(hub, 0, swingCentre(partial, 0));
  const reversePhaseConstant = meshPhase(output, 0, reverse);

  return { ...partial, seats, swingPhaseConstant, reversePhaseConstant };
}

/** Tooth phase of the swing gear, which is a planet on the yoke. */
export function swingPhase(t: Tumbler, hubPhase: number, yokeRadians: number): number {
  return planetPhase(t.hub, t.swing, hubPhase, yokeRadians, t.swingPhaseConstant);
}

/** Tooth phase of the reverse gear, which is driven by the output. */
export function reversePhase(t: Tumbler, outputPhase: number): number {
  return -(t.output.teeth / t.reverse.teeth) * outputPhase + t.reversePhaseConstant;
}

/**
 * Output turns per hub turn, signed. The magnitude is the hub/output tooth
 * ratio either way; only the sign changes with the seat.
 */
export function outputRatio(t: Tumbler, seat: Seat): number {
  const magnitude = t.hub.teeth / t.output.teeth;
  return seat === 'direct' ? magnitude : -magnitude;
}

/**
 * How far the output must turn for the incoming tooth to drop into a space.
 *
 * Engaging a stationary train is a crash shift. In the direct seat the swing
 * gear lands on the output and the output itself takes up; in the reversed seat
 * it lands on the reverse gear, whose take-up reaches the output through their
 * ratio — which happens to cancel to the same magnitude, with the sign flipped.
 */
export function seatTakeUp(
  t: Tumbler,
  seat: Seat,
  hubPhase: number,
  outputPhase: number,
): number {
  const yoke = t.seats[seat];
  const swing = swingCentre(t, yoke);
  const phase = swingPhase(t, hubPhase, toRadians(yoke));
  if (seat === 'direct') {
    return engagementTakeUp(swing, phase, t.output, outputPhase);
  }
  const atReverse = engagementTakeUp(swing, phase, t.reverse, reversePhase(t, outputPhase));
  return -atReverse * (t.reverse.teeth / t.output.teeth);
}

/** Total yoke travel between the seats, in degrees. */
export function seatTravel(t: Tumbler): number {
  return t.seats.direct - t.seats.reversed;
}

/** Degrees of the yoke, as the SVG transform wants them. */
export function seatDegrees(t: Tumbler, seat: Seat): number {
  return t.seats[seat];
}

export { toDegrees };
