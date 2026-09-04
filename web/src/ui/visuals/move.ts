/**
 * A scripted move: a part being taken somewhere by the machine rather than by
 * the mechanism.
 *
 * Homing before a run, being called up the shaft, landing into a floor,
 * parking at the end, and the throw of a shifter fork are all this one thing
 * with different destinations and different reasons. Keeping them one concept
 * is what stops them becoming five overlapping flags that interact in ways
 * nobody has written down.
 *
 * A move does not decide whether it is worth making. A hold with nowhere to go
 * is still a hold — the machine keeps the car for the whole of the pointer's
 * fall even when the car is already home — so the caller skips it, not this.
 */
import { lerp } from '../../mech';
import { easeInOut } from '../primitives/anim';

export type Ease = (t: number) => number;

export class Move {
  private t = 1;
  private origin = 0;
  private target = 0;
  private ms = 1;
  private ease: Ease = easeInOut;

  /** Begins the journey. */
  start(from: number, to: number, ms: number, ease: Ease = easeInOut): void {
    this.origin = from;
    this.target = to;
    this.ms = Math.max(1, ms);
    this.ease = ease;
    this.t = 0;
  }

  /** Places it at the far end at once, with no journey. */
  snap(to: number): void {
    this.origin = to;
    this.target = to;
    this.t = 1;
  }

  /** Advances one frame. True on the frame it arrives, once. */
  update(dt: number): boolean {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / this.ms);
    return this.t === 1;
  }

  get value(): number {
    return lerp(this.origin, this.target, this.ease(this.t));
  }

  /** How far through, 0..1. Stages of a longer sequence are cut from this. */
  get progress(): number {
    return this.t;
  }

  get running(): boolean {
    return this.t < 1;
  }

  get destination(): number {
    return this.target;
  }

  get remainingMs(): number {
    return this.running ? (1 - this.t) * this.ms : 0;
  }
}
