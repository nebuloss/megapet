/**
 * The pointer: the one part of an instrument that carries a reading.
 *
 * Every instrument in this app has one, whether or not anything is geared to
 * it, so it lives here rather than inside either visual. It owns three things
 * that took several goes to get right, and owning them once is the point:
 *
 * - it moves on the **scale's** position, never on the megabits. The scale is
 *   logarithmic, so easing the value and converting per frame swept the needle
 *   across half the dial in the first frame of every phase.
 * - it has a **speed**, not just a time constant. An exponential ease alone
 *   arrives in roughly constant time however far it goes, which let the link
 *   decide how fast the animation ran.
 * - falling back to the stop is a **scripted sweep**, not a tracked reading. At
 *   the reading's own time constant a full-scale drop was 36 degrees in the
 *   first frame and over in three.
 */
import { easeInOut, approach, limitStep } from '../primitives/anim';
import { lerp } from '../../mech';
import { EASE_TAU, MAX_MBPS, SWEEP_MS, fromFraction, sweepMs, toFraction } from './scale';

export class Pointer {
  /** Where it points, 0..1 along the scale. Everything geared to it reads this. */
  private fraction = 0;
  /** Where it pointed last frame, so a driver can be handed the difference. */
  private last = 0;
  /** Where it is heading, 0..1. Converted when the target is set, not per frame. */
  private aimFraction = 0;

  /** What was asked for, kept only for readings the dial cannot reach. */
  private targetMbps = 0;

  /** The scripted fall back to the stop; 1 when it is not falling. */
  private fallT = 1;
  private fallFrom = 0;
  private fallMs = SWEEP_MS;

  /** Where it points now, 0..1. */
  get position(): number {
    return this.fraction;
  }

  /** How far it moved on the last update — what a drive train is handed. */
  get delta(): number {
    return this.fraction - this.last;
  }

  /**
   * The reading to print, in megabits — derived from where the pointer is, so
   * the number and the pointer cannot disagree.
   *
   * Above full scale the pointer is pinned and cannot say how far past the end
   * the reading is, so the true figure is printed instead. That is the honest
   * answer: the instrument is off its scale, and the number should still be
   * right even though the pointer has run out of dial.
   */
  get reading(): number {
    // The pointer approaches full scale asymptotically and never quite lands
    // on it, so "is it pinned" cannot be an equality.
    const pinned = this.fraction > 1 - 1e-6;
    return pinned && this.targetMbps > MAX_MBPS ? this.targetMbps : fromFraction(this.fraction);
  }

  /** How long it still needs, if it is mid-fall. */
  get busyMs(): number {
    return this.fallT < 1 ? (1 - this.fallT) * this.fallMs : 0;
  }

  get falling(): boolean {
    return this.fallT < 1;
  }

  /** True once it has arrived and has nothing left to do. */
  get settled(): boolean {
    return this.fallT === 1 && Math.abs(this.aimFraction - this.fraction) < 0.0005;
  }

  /** Sets where it is heading. Reading and scale position move together. */
  aim(mbps: number): void {
    const value = Number.isFinite(mbps) && mbps > 0 ? mbps : 0;
    const next = toFraction(value);
    if (next === 0 && this.aimFraction > 0) {
      // Only on the way down, and only once: a phase that re-sends zero ten
      // times a second would otherwise restart the sweep on every snapshot and
      // the pointer would never arrive.
      this.fallFrom = this.fraction;
      this.fallMs = sweepMs(this.fraction);
      this.fallT = 0;
    } else if (next > 0) {
      this.fallT = 1;
    }
    this.targetMbps = value;
    this.aimFraction = next;
  }

  /** Advances one frame. Returns how far it moved, for whatever it drives. */
  update(dt: number): number {
    this.last = this.fraction;
    if (this.fallT < 1) {
      this.fallT = Math.min(1, this.fallT + dt / this.fallMs);
      this.fraction = lerp(this.fallFrom, 0, easeInOut(this.fallT));
      return this.delta;
    }
    // The exponential decides the shape, the limit decides the speed.
    const wanted = approach(this.fraction, this.aimFraction, dt, EASE_TAU) - this.fraction;
    this.fraction += limitStep(wanted, dt, SWEEP_MS);
    return this.delta;
  }

  /** Snaps it to where it is heading, with no journey. */
  settle(): void {
    this.last = this.fraction;
    this.fraction = this.aimFraction;
    this.fallT = 1;
  }

  /** Puts it back at the stop, for a fresh run under reduced motion. */
  rest(): void {
    this.last = 0;
    this.fraction = 0;
    this.aimFraction = 0;
    this.targetMbps = 0;
    this.fallT = 1;
  }
}
