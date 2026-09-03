import { clamp, lerp } from '../../../mech';
import { easeInOut } from '../../primitives/anim';
import { CAR, CAR_BOTTOM, TRAVEL } from './layout';

/**
 * Everything that decides where the car sits on a given frame.
 *
 * The car's position is carried state: it is integrated from how far the
 * needle moved, never computed from where the needle is. Deriving it — say
 * `CAR.top + driveSign * fraction * TRAVEL` — teleports the car the instant
 * `driveSign` flips, because the eased reading has not fallen to zero yet.
 */
export interface CarriageInput {
  /** Where the car is now. */
  readonly top: number;
  /** Needle position this frame, 0..1. */
  readonly fraction: number;
  /** Needle position last frame, 0..1. */
  readonly lastFraction: number;
  /** +1 while the open belt lowers the car, -1 while the crossed belt raises it. */
  readonly driveSign: number;
  /** Brake on: the belt is mid-shift, so needle movement drives nothing. */
  readonly held: boolean;
  /** Return-to-top-floor progress, 0..1; 1 when not homing. */
  readonly homing: number;
  /** Where the car was when homing began. */
  readonly homeFrom: number;
}

/**
 * The car's next position.
 *
 * Three cases, in priority order: the machine is driving it home before a run;
 * the brake holds it while the belt is being crossed; otherwise the belt
 * carries it by however far the needle just moved.
 */
export function carriageTop(input: CarriageInput): number {
  if (input.homing < 1) {
    return lerp(input.homeFrom, CAR.top, easeInOut(input.homing));
  }
  if (input.held) {
    return input.top;
  }
  const travelled = input.driveSign * (input.fraction - input.lastFraction) * TRAVEL;
  return clamp(input.top + travelled, CAR.top, CAR_BOTTOM);
}
