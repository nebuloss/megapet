/**
 * The graph's leading edge.
 *
 * A time series gains a point a second, but the line has to move sixty times a
 * second or the eye reads it as a staircase. So the newest reading is drawn as
 * a provisional point at "now", ahead of the last committed sample, and this
 * is what decides where that point sits.
 *
 * It eases towards the live reading rather than snapping to it. The important
 * part is *what* is eased: the **fraction** on the log scale, never the Mbps.
 * Easing the value and converting per frame is the same mistake the dial's
 * needle exists to avoid — on a logarithmic axis the first frame of a jump
 * from 0 to 940 Mbps lands near the top of the plot, so the line leaps and
 * then crawls. Easing the fraction gives a constant-looking speed at every
 * scale.
 */
import { toFraction, fromFraction } from './scale';

/** Time constant of the ease, in milliseconds. */
const TAU = 90;

/**
 * The most of the plot's height the edge may cross in a second.
 *
 * Without a limit the ease has no speed of its own, only a half-life, so a
 * large jump still moves alarmingly fast in its first frames. A third of the
 * height per second is fast enough to feel immediate and slow enough to read.
 */
const MAX_FRACTION_PER_SECOND = 0.34;

export class LeadingEdge {
  private fraction = 0;
  private target = 0;
  private started = false;

  /** Sets the reading to chase, in Mbps. */
  setTarget(mbps: number): void {
    this.target = toFraction(Number.isFinite(mbps) ? Math.max(0, mbps) : 0);
    if (!this.started) {
      // The first reading is where the line begins; easing up to it from zero
      // would draw a climb that never happened.
      this.fraction = this.target;
      this.started = true;
    }
  }

  /** Drops back to the floor, for a test that has stopped. */
  reset(): void {
    this.fraction = 0;
    this.target = 0;
    this.started = false;
  }

  /** Advances the ease by `dtMs` and returns the reading to draw, in Mbps. */
  advance(dtMs: number): number {
    const step = Math.max(0, Math.min(250, dtMs));
    const gap = this.target - this.fraction;
    if (Math.abs(gap) < 1e-4) {
      this.fraction = this.target;
      return fromFraction(this.fraction);
    }
    const eased = gap * (1 - Math.exp(-step / TAU));
    const limit = (MAX_FRACTION_PER_SECOND * step) / 1000;
    this.fraction += Math.sign(eased) * Math.min(Math.abs(eased), limit);
    return fromFraction(this.fraction);
  }

  /** The reading currently drawn, without advancing. */
  get current(): number {
    return fromFraction(this.fraction);
  }
}
