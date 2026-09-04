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
import {
  Assembly,
  Derived,
  Flag,
  bearing,
  clamp,
  detentLift,
  drumPin,
  lerp,
  polar,
  springOutline,
  strands,
  tangentPoint,
  toRadians,
  wrapTau,
  type Strand,
} from '../../../../mech';
import { easeInOut, easeOutBack, stage } from '../../../primitives/anim';
import type { Drive } from '../../visual';
import {
  BRAKE,
  CAR,
  CROSS_FOR,
  DRIVE,
  DRIVEN,
  FORK,
  LEVER,
  PAWL_ANGLE,
  PAWL_LIFT,
  PAWL_WIDTH,
  PULLEY,
  ROPE_PIN_BASE,
  ROPE_RUN_X,
  SHIFT_DRUM_R,
  SHIFT_MS,
  SPRING_ANCHOR,
  SPRING_PIN_BASE,
  SPRING_PIN_R,
  STAGE,
} from '../layout';
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

  /**
   * How much slack there is in the belt as it is walked across, 0..1.
   *
   * Cut from the crossing's own progress rather than from how crossed the belt
   * is: a throw taken up partway through another one starts from wherever the
   * fork had got to, and a belt that is already half crossed still goes fully
   * slack on its way to the other seat.
   */
  get slack(): number {
    return Math.sin(Math.PI * easeInOut(stage(this.stroke.progress, STAGE.cross)));
  }

  /** Where the fork sits, in degrees — what the detent and spring read. */
  get forkAngle(): number {
    return FORK.open + this.cross * (FORK.crossed - FORK.open);
  }
}

/** One strand of the belt, bowed by however slack it is mid-shift. */
function strandShape({ from, to }: Strand, slack: number): string {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const bow = slack * 9;
  return (
    `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} ` +
    `Q ${(midX - (dy / length) * bow).toFixed(2)} ${(midY + (dx / length) * bow).toFixed(2)} ` +
    `${to.x.toFixed(2)} ${to.y.toFixed(2)}`
  );
}

/**
 * The control rope: off the lever's pin, along the car's outrigger, up the
 * shaft, over the guide pulley and made off on the fork's drum.
 *
 * It is the one part of the reversing gear that also depends on the hoist,
 * because the lever it is pulled by rides in the car.
 */
function ropeShape(carTop: number, leverDegrees: number, forkDegrees: number): string {
  const lever = toRadians(leverDegrees);
  const pin = {
    x: LEVER.x + LEVER.arm * Math.sin(lever),
    y: carTop + LEVER.y - LEVER.arm * Math.cos(lever),
  };
  const tangent = tangentPoint(PULLEY, FORK, SHIFT_DRUM_R, 1);
  const madeOff = drumPin(FORK, SHIFT_DRUM_R, toRadians(ROPE_PIN_BASE), toRadians(forkDegrees));
  const wrap = wrapTau(bearing(FORK, madeOff) - bearing(FORK, tangent));
  const leaves = polar(
    PULLEY,
    PULLEY.r,
    bearing(PULLEY, tangent) -
      Math.acos(PULLEY.r / Math.hypot(tangent.x - PULLEY.x, tangent.y - PULLEY.y)),
  );
  return (
    `M ${pin.x.toFixed(2)} ${pin.y.toFixed(2)}` +
    ` L 89 ${(carTop + 9).toFixed(2)}` +
    ` L ${CAR.x - CAR.w / 2} ${(carTop + 14).toFixed(2)}` +
    ` L ${ROPE_RUN_X.toFixed(2)} ${(carTop + 14).toFixed(2)}` +
    ` L ${ROPE_RUN_X.toFixed(2)} ${PULLEY.y.toFixed(2)}` +
    ` A ${PULLEY.r} ${PULLEY.r} 0 0 1 ${leaves.x.toFixed(2)} ${leaves.y.toFixed(2)}` +
    ` L ${tangent.x.toFixed(2)} ${tangent.y.toFixed(2)}` +
    ` A ${SHIFT_DRUM_R} ${SHIFT_DRUM_R} 0 ${wrap > Math.PI ? 1 : 0} 1 ${madeOff.x.toFixed(2)} ${madeOff.y.toFixed(2)}`
  );
}

/**
 * Everything the reversing gear moves, read off its one throw.
 *
 * @param carTop Where the car is, for the lever that rides in it and the rope
 * it pulls — the only thing here the gear cannot answer for itself.
 */
export function reversingParts(gear: ReversingGear, carTop: () => number): Assembly {
  const brakeDir = toRadians(BRAKE.angle);
  const pawlDir = toRadians(PAWL_ANGLE);
  const belt = (which: 0 | 1, sign: 1 | -1): (() => string) => {
    return () => strandShape(strands(DRIVE, DRIVEN, gear.cross)[which], sign * gear.slack);
  };
  return new Assembly(
    'reversing',
    new Derived('beltA', belt(0, 1), 'path'),
    new Derived('beltB', belt(1, -1), 'path'),
    new Derived('shifter', () => `rotate(${gear.forkAngle.toFixed(2)} ${FORK.x} ${FORK.y})`),
    new Derived('lever', () => `rotate(${gear.leverAngle.toFixed(2)} ${LEVER.x} ${LEVER.y})`),
    new Derived(
      'brakeShoe',
      () =>
        `translate(${(-Math.cos(brakeDir) * BRAKE.lift * gear.brakeForce).toFixed(2)} ` +
        `${(-Math.sin(brakeDir) * BRAKE.lift * gear.brakeForce).toFixed(2)})`,
    ),
    new Derived('pawl', () => {
      const lift = detentLift(gear.forkAngle, [FORK.open, FORK.crossed], PAWL_LIFT, PAWL_WIDTH);
      return `translate(${(Math.cos(pawlDir) * lift).toFixed(2)} ${(Math.sin(pawlDir) * lift).toFixed(2)})`;
    }),
    new Derived('rope', () => ropeShape(carTop(), gear.leverAngle, gear.forkAngle), 'path'),
    new Derived(
      'spring',
      () =>
        springOutline(
          SPRING_ANCHOR,
          drumPin(FORK, SPRING_PIN_R, toRadians(SPRING_PIN_BASE), toRadians(gear.forkAngle)),
        ),
      'path',
    ),
    // Whether the shoe *looks* pressed, which is a narrower window than the
    // hold: the brake is on for the whole throw, and `holding` is what says so.
    new Flag('braked', () => gear.brakeForce > 0.5),
    new Flag('shifting', () => gear.throwing),
  );
}
