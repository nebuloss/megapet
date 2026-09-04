/**
 * A drive train: parts that pass motion to the part they drive.
 *
 * The machine reads the way it works. A needle turns a gear, the gear turns
 * the one it meshes with, that one turns a pulley, the belt carries it to the
 * sheave, and the sheave lifts the car:
 *
 *     needle.turn(delta)  ->  hub  ->  lay  ->  belt  ->  sheave  ->  car
 *
 * Two rules make the difference between this working and this being the bug
 * this project has fixed three times.
 *
 * **Motion is passed as increments, never as positions.** A train that sets
 * absolute positions — `car.moveTo(fraction * travel * sign)` — throws the car
 * the length of the shaft the instant the sign flips, because the input has not
 * caught up with the reversal yet. Increments cannot do that: whatever the
 * ratio, a small input is a small output.
 *
 * **A part may decline.** A brake refuses to turn; a carriage the machine has
 * taken over ignores its rope. Declining is how the model says "the mechanism
 * is not in charge of this right now", and it is why the same train can be
 * driven by the needle during a test and by the machine between phases. It
 * also means a delta is always offered exactly once and either used or
 * dropped, so there is no running total to forget to clear.
 */
import { clamp } from './geometry';
import type { Gear } from './gear';

/** Anything the part before it can drive. */
export interface Driven {
  /** Accept `delta` of the driver's motion, in the driver's own units. */
  drive(delta: number): void;
}

/** A part that turns, and turns whatever it drives. */
export class Rotation implements Driven {
  private turned = 0;

  constructor(private readonly output: Driven | null = null) {}

  /** Radians turned since the train was assembled. */
  get phase(): number {
    return this.turned;
  }

  drive(delta: number): void {
    this.turned += delta;
    this.output?.drive(delta);
  }

  /** Places the part without driving anything, for seating a fresh train. */
  seat(phase: number): void {
    this.turned = phase;
  }
}

/**
 * A meshed gear pair.
 *
 * The ratio is tooth counts, never radii, and it is negative because meshed
 * gears turn opposite ways. Both gears must be cut to one module or their
 * teeth cannot engage, so the pair refuses to exist otherwise — the invariant
 * the free functions could only document.
 */
export class GearPair implements Driven {
  readonly ratio: number;

  constructor(
    readonly driver: Gear,
    readonly driven: Gear,
    private readonly output: Driven | null = null,
  ) {
    const driverModule = (2 * driver.radius) / driver.teeth;
    const drivenModule = (2 * driven.radius) / driven.teeth;
    if (Math.abs(driverModule - drivenModule) > 1e-9) {
      throw new RangeError(
        `gears cut to different modules cannot mesh: ${driverModule} and ${drivenModule}`,
      );
    }
    this.ratio = -driver.teeth / driven.teeth;
  }

  drive(delta: number): void {
    this.output?.drive(delta * this.ratio);
  }
}

/**
 * A belt between two pulleys.
 *
 * `cross` runs 0 (open) to 1 (crossed); crossing reverses what the belt
 * transmits, which is what reverses the machine. The sign is latched when a
 * shift begins rather than read continuously, because mid-throw the belt is
 * neither open nor crossed and the question has no answer. Nothing downstream
 * is moving then anyway — the brake has it.
 */
export class BeltDrive implements Driven {
  private sign = 1;

  constructor(
    private readonly driverRadius: number,
    private readonly drivenRadius: number,
    private readonly output: Driven | null = null,
  ) {}

  /** Latches the direction the belt will transmit once it is seated. */
  setCrossed(crossed: boolean): void {
    this.sign = crossed ? -1 : 1;
  }

  get ratio(): number {
    return this.sign * (this.driverRadius / this.drivenRadius);
  }

  drive(delta: number): void {
    this.output?.drive(delta * this.ratio);
  }
}

/** A brake. While it is set, nothing beyond it moves, whatever the driver does. */
export class Brake implements Driven {
  set = false;

  constructor(private readonly output: Driven | null = null) {}

  drive(delta: number): void {
    if (this.set) return;
    this.output?.drive(delta);
  }
}

/**
 * Something that travels in a line, driven by a rotation.
 *
 * Its position is carried — integrated from what drives it — and never
 * computed from the input, which is the whole reason this class exists. While
 * `held`, it ignores its driver: that is the machine taking it over to move it
 * somewhere the mechanism cannot, and the only other way its position changes.
 */
export class Travel implements Driven {
  held = false;

  constructor(
    private position: number,
    private readonly min: number,
    private readonly max: number,
    /** Distance travelled per radian of the part driving it. */
    private readonly perRadian: number,
  ) {}

  get value(): number {
    return this.position;
  }

  drive(delta: number): void {
    if (this.held) return;
    this.moveTo(this.position + delta * this.perRadian);
  }

  /** Places it directly. The machine's way in, and it still cannot leave the run. */
  moveTo(position: number): void {
    this.position = clamp(position, this.min, this.max);
  }
}
