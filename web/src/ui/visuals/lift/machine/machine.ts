/**
 * The lift machine: the pointer, the train it drives, and the shaft below it.
 *
 * Everything that moves lives here and nothing here knows what a document is,
 * so the whole machine can be assembled, run for a thousand frames and read
 * back in a test. What it is told is the shape of a run — reverse, land, ride,
 * home — and it answers with how long each will take, so the runner can hold a
 * phase open for exactly as long as the move it covers.
 *
 * Three numbers are carried and everything else is derived from them: where
 * the pointer is, how far through its throw the reversing gear is, and where
 * the car is in the shaft. The frame order below is the whole contract.
 */
import {
  Assembly,
  BeltDrive,
  Brake,
  Derived,
  GearPair,
  Quantity,
  Rotation,
  toRadians,
  type Driven,
  type Scene,
} from '../../../../mech';
import { Pointer } from '../../pointer';
import { sweepMs } from '../../scale';
import type { Drive } from '../../visual';
import {
  CAR,
  CAR_BOTTOM,
  CAR_REST,
  DRIVE,
  DRIVEN,
  HUB,
  LAY,
  START_ANGLE,
  SWEEP_RAD,
  rideMs,
} from '../layout';
import { armTransform } from '../nookie';
import { Car } from './car';
import { hoist } from './hoist';
import { instrument } from './instrument';
import { ReversingGear, reversingParts } from './reversing';

/** Closer than this and a journey is not worth making. */
const ARRIVED = 0.5;

export class LiftMachine {
  private readonly pointer = new Pointer();
  private readonly car = new Car();
  private readonly gear = new ReversingGear();

  private readonly hub: Rotation;
  private readonly lay: Rotation;
  private readonly belt: BeltDrive;
  private readonly brake: Brake;

  private readonly parts: Assembly;

  /** Which way the car travels as the reading rises. */
  private drive: Drive = 'up';

  /**
   * @param still Whether every move should land at once instead of being
   * played. Reduced motion, asked each time rather than fixed at assembly, so
   * the setting can be changed while the page is open.
   */
  constructor(private readonly still: () => boolean = () => false) {
    // Assembled from the far end back, because each part is given the part it
    // drives: pointer -> hub -> mesh -> layshaft -> belt -> brake -> rope ->
    // car. The rope takes the sheave's turn the other way round, because the
    // car hangs on the side that rises when the reading does.
    const rope: Driven = { drive: (delta) => this.car.drive(-delta) };
    this.brake = new Brake(rope);
    this.belt = new BeltDrive(DRIVE.radius, DRIVEN.radius, this.brake);
    this.lay = new Rotation(this.belt);
    const pair = new GearPair(HUB, LAY, this.lay);
    this.hub = new Rotation(pair);
    // Seated rather than driven, so the pointer starts against its stop with
    // the layshaft already where that mesh puts it.
    this.hub.seat(toRadians(START_ANGLE));
    this.lay.seat(toRadians(START_ANGLE) * pair.ratio);
    this.belt.setCrossed(true);

    this.parts = new Assembly(
      'lift',
      instrument(this.pointer, this.hub, this.lay),
      reversingParts(this.gear, () => this.car.position),
      hoist(this.car, () => this.pointer.position),
      // The passenger: he has one job, and he is only drawn doing it while he
      // has hold of the lever. An empty transform hands his arm back to the
      // stylesheet, which has him waving on his own.
      new Assembly(
        'passenger',
        new Derived('arm', () =>
          this.gear.grip > 0.002 ? armTransform(this.gear.leverAngle, this.gear.grip) : '',
        ),
        new Quantity('nookie-bob', () => `${(2.6 - this.pointer.position * 1.8).toFixed(2)}s`),
      ),
    );
  }

  // ------------------------------------------------------------- the run --

  /** Which way it is currently set to travel. */
  get direction(): Drive {
    return this.drive;
  }

  /** The reading to print, in megabits, derived from where the pointer is. */
  get reading(): number {
    return this.pointer.reading;
  }

  /** Sends the pointer to a reading. */
  aim(mbps: number): void {
    this.pointer.aim(mbps);
    if (this.still()) this.settle();
  }

  /**
   * Reverses the drive.
   *
   * Queued behind whatever journey the car is making, because the gear cannot
   * be thrown while it is still running: the shift waits for the landing, and
   * `transitionMs` covers both.
   */
  reverse(direction: Drive): void {
    this.drive = direction;
    if (this.still()) {
      this.gear.seat(direction);
      this.belt.setCrossed(direction === 'up');
      return;
    }
    this.car.order(() => {
      this.gear.begin(direction);
      // Latched as the throw begins rather than read from how crossed the belt
      // looks: mid-throw it is neither open nor crossed and the question has no
      // answer. Nothing beyond the brake is moving then anyway.
      this.belt.setCrossed(direction === 'up');
    });
  }

  /**
   * Finishes the leg into the floor it was heading for.
   *
   * A leg that stops wherever the reading left it reads as an abandoned
   * journey: 940 Mbps on a scale that reaches ten gigabits parks the car three
   * quarters of the way down and leaves it there.
   */
  land(): void {
    if (this.still()) {
      this.car.place(this.drive === 'down' ? CAR_BOTTOM : CAR.top);
      return;
    }
    this.car.land(this.drive === 'down' ? 1 : -1);
  }

  /** A journey at lift speed, queued behind whatever is under way. */
  ride(to: number): number {
    if (this.still()) {
      this.car.place(to);
      return 0;
    }
    const ms = rideMs(Math.abs(to - this.car.destination));
    this.car.order(() => this.car.rideTo(to));
    return ms;
  }

  /** Everything back to rest before a run. */
  reset(): void {
    this.pointer.aim(0);
    this.drive = 'up';
    this.gear.seat('up');
    this.belt.setCrossed(true);
    // Nothing queued from the last run survives into this one: a test
    // abandoned during a reversal leaves a shift waiting behind the landing.
    this.car.clear();

    if (this.still()) {
      this.settle();
      this.car.place(CAR_REST);
      return;
    }
    // The hold has two jobs and must be long enough for both. It has to outlast
    // the pointer's fall, because the pointer turns the sheave through the belt
    // and would otherwise drag the car back up the shaft. And it has to be long
    // enough for the distance, or the car is thrown home: pressing Start while
    // the car was still parking after a slow upload sized this from a 200ms
    // fall and moved it 19.9 units in one frame, against a budget of 6.4.
    //
    // A hold with nowhere to go is still a hold, so the fall cannot reach the
    // car — but a first run has neither a fall to outlast nor a distance to
    // cover, and must not be made to wait for one.
    const fall =
      this.pointer.position > 0
        ? Math.max(this.pointer.busyMs, sweepMs(this.pointer.position))
        : 0;
    if (fall > 0 || Math.abs(CAR_REST - this.car.position) >= ARRIVED) this.car.home(fall);
  }

  /** How long the machine needs before it is worth measuring anything. */
  settleMs(): number {
    return Math.round(Math.max(this.car.busyMs, this.pointer.busyMs));
  }

  // ----------------------------------------------------------- the frame --

  /**
   * Advances the whole machine by `dt`. True once there is nothing left to do.
   *
   * The order is the contract. The pointer moves first, because everything
   * geared to it is handed the difference. The reversing gear moves next, so
   * the brake's state belongs to this frame rather than the last. Then the
   * delta goes into the train — always, whether or not anything downstream
   * will take it, because a delta saved up while the car is held arrives all
   * at once the moment it is let go. Then the car, whose order queue drains
   * here, behind the journey it was making.
   */
  update(dt: number): boolean {
    const moved = this.pointer.update(dt);
    this.gear.update(dt);
    this.turn(moved);
    this.car.update(dt);

    const idle = this.pointer.settled && !this.gear.throwing && this.car.free;
    if (idle) this.settle();
    return idle;
  }

  /** Writes the whole machine into a scene. Reads state; never changes it. */
  place(scene: Scene): void {
    this.parts.place(scene);
  }

  /** Puts the pointer where it was heading, taking the train with it. */
  private settle(): void {
    this.pointer.settle();
    this.turn(this.pointer.delta);
  }

  /**
   * Hands the pointer's move to the train.
   *
   * The brake is set first, so the pointer still turns the gears and walks the
   * belt through a throw while nothing beyond them moves. It holds for the
   * whole throw, which is wider than the window the shoe is drawn closing in.
   */
  private turn(delta: number): void {
    this.brake.set = this.gear.holding;
    this.hub.drive(delta * SWEEP_RAD);
  }
}
