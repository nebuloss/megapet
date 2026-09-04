/**
 * The reversing gear: the fork, the drum, the detent, the return spring, the
 * control rope, and the lever in the car that throws it.
 *
 * One number moves: how far through its throw the fork is. Everything else
 * here is read off that. The belt's crossing, the lever's angle, the bear's
 * grip on it, and how hard the brake is applied are all cut from the same
 * progress at different stages, so they cannot drift apart and there is
 * nothing to keep in step by hand.
 *
 * The brake holds for the *whole* throw, which is wider than the window the
 * brake is drawn closing in. That is deliberate: the hold is what makes the
 * reversal safe, and narrowing it to match the drawing would let the car move
 * during the first and last tenth of every throw.
 */
import { clamp, lerp } from '../../../../mech';
import { easeInOut, easeOutBack, stage } from '../../../primitives/anim';
import type { Drive } from '../../visual';
import { CROSS_FOR, FORK, LEVER, SHIFT_MS, STAGE } from '../layout';
import { Move } from '../../move';

export class ReversingGear {
  private readonly stroke = new Move();
  private crossFrom = CROSS_FOR.up;
  private crossTo = CROSS_FOR.up;
  private leverFrom = LEVER.seatUp;
  private leverTo = LEVER.seatUp;

  /** Throws the fork across. Reads its own current position as the start. */
  begin(direction: Drive): void {
    this.crossFrom = this.cross;
    this.leverFrom = this.leverAngle;
    this.crossTo = CROSS_FOR[direction];
    this.leverTo = direction === 'down' ? LEVER.seatDown : LEVER.seatUp;
    // Linear: the stages below do the easing, each over its own part of it.
    this.stroke.start(0, 1, SHIFT_MS, (t) => t);
  }

  /** Puts it in a seat at once, for a fresh machine or reduced motion. */
  seat(direction: Drive): void {
    this.crossFrom = this.crossTo = CROSS_FOR[direction];
    this.leverFrom = this.leverTo = direction === 'down' ? LEVER.seatDown : LEVER.seatUp;
    this.stroke.snap(1);
  }

  /** Advances the throw. True on the frame it seats. */
  update(dt: number): boolean {
    return this.stroke.update(dt);
  }

  /** How long a throw takes, for whoever has to wait for one. */
  get durationMs(): number {
    return SHIFT_MS;
  }

  get throwing(): boolean {
    return this.stroke.running;
  }

  /** The brake is on for the whole throw, and the car is genuinely let go. */
  get holding(): boolean {
    return this.stroke.running;
  }

  /** Belt crossing, 0 open to 1 crossed. */
  get cross(): number {
    return lerp(this.crossFrom, this.crossTo, easeInOut(stage(this.stroke.progress, STAGE.cross)));
  }

  /** The lever in the car, in degrees. Lands with a small mechanical snap. */
  get leverAngle(): number {
    return lerp(
      this.leverFrom,
      this.leverTo,
      easeOutBack(stage(this.stroke.progress, STAGE.lever)),
    );
  }

  /** How much of the bear's hand is on the lever: reaches, then lets go. */
  get grip(): number {
    const p = this.stroke.progress;
    return easeInOut(stage(p, STAGE.reach)) * (1 - easeInOut(stage(p, STAGE.release)));
  }

  /** How hard the shoe is pressed to the sheave, 0..1. */
  get brakeForce(): number {
    const p = this.stroke.progress;
    return clamp(easeInOut(stage(p, STAGE.brake)) - easeInOut(stage(p, STAGE.unbrake)), 0, 1);
  }

  /** Where the fork sits, in degrees — what the detent and spring read. */
  get forkAngle(): number {
    return FORK.open + this.cross * (FORK.crossed - FORK.open);
  }
}
