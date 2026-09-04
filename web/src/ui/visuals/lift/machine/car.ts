/**
 * The car: the one part of the hoist that carries a position.
 *
 * Two things move it and they never both move it at once. The rope moves it,
 * through `drive`, by however far the sheave turned — carried, integrated,
 * never computed from the reading, because a position computed from the
 * reading leaps the length of the shaft the moment the drive reverses. And the
 * machine moves it, by taking it over: homing it before a run, calling it up
 * the shaft, landing it into a floor, parking it at the end. While the machine
 * has it, the rope is ignored, which is the whole of what "the machine has it"
 * means.
 *
 * Work that has to happen after the current journey is queued rather than
 * timed. That is what stops a shift being thrown while the car is still
 * running, and it is why the queue drains until something actually starts
 * moving: a journey with nowhere to go must not swallow the order behind it.
 */
import { Travel, type Driven } from '../../../../mech';
import { Move } from '../../move';
import { CAR, CAR_BOTTOM, CAR_REST, LAND_MS, SHEAVE, rideMs } from '../layout';

/** Closer than this and a journey is not worth making. */
const ARRIVED = 0.5;

export class Car implements Driven {
  private readonly travel: Travel;
  private readonly journey = new Move();
  private readonly orders: Array<() => void> = [];

  constructor(at: number = CAR_REST) {
    this.travel = new Travel(at, CAR.top, CAR_BOTTOM, SHEAVE.radius);
  }

  /** Where it is in the shaft. */
  get position(): number {
    return this.travel.value;
  }

  /** True when the rope has it and nothing is waiting. */
  get free(): boolean {
    return !this.journey.running && this.orders.length === 0;
  }

  /** How long until the machine lets go. */
  get busyMs(): number {
    return this.journey.remainingMs;
  }

  /** Where it will be when the machine lets go — for sizing the next journey. */
  get destination(): number {
    return this.journey.running ? this.journey.destination : this.travel.value;
  }

  /** Driven by the rope. Ignored while the machine has it. */
  drive(delta: number): void {
    this.travel.drive(delta);
  }

  /** The machine takes it somewhere. Returns how long that will take. */
  take(to: number, ms: number): number {
    this.journey.start(this.travel.value, to, ms);
    this.travel.held = true;
    return ms;
  }

  /**
   * Finishes the leg into the floor it was heading for.
   *
   * A leg that stops wherever the reading left it reads as an abandoned
   * journey: a 940 Mbps download on a scale that reaches ten gigabits parks
   * the car three quarters of the way down and leaves it there.
   */
  land(driveSign: number): number {
    const floor = driveSign > 0 ? CAR_BOTTOM : CAR.top;
    // A landing finishes a leg the rope was carrying. If the machine is
    // already taking the car to that floor, there is no unfinished leg —
    // overtaking its journey to redo whatever is left in LAND_MS rushes it.
    // That is what made the opening ride look like a jump to the top: the
    // reversal into the download lands a car that is still being called up,
    // and the remaining three quarters of the shaft got a single second.
    if (this.journey.running && Math.abs(this.journey.destination - floor) < ARRIVED) {
      return this.journey.remainingMs;
    }
    return this.take(floor, LAND_MS);
  }

  /** A journey at lift speed, so a longer trip takes proportionally longer. */
  rideTo(to: number): number {
    const distance = Math.abs(to - this.destination);
    if (distance < ARRIVED) return 0;
    return this.take(to, rideMs(distance));
  }

  /**
   * Home to the ground floor before a run.
   *
   * The hold has two jobs and must be long enough for both: to outlast the
   * pointer's fall, because the pointer turns the sheave through the belt and
   * would otherwise drag the car back up the shaft; and to carry the car the
   * distance, because sizing it from the fall alone threw the car home.
   */
  home(fallMs: number): number {
    return this.take(CAR_REST, Math.max(fallMs, rideMs(Math.abs(CAR_REST - this.travel.value))));
  }

  /** Back to the ground floor once the run is over. */
  park(): number {
    return this.rideTo(CAR_REST);
  }

  /** Queues work behind whatever the machine is already doing with the car. */
  order(work: () => void): void {
    if (this.journey.running) this.orders.push(work);
    else work();
  }

  /**
   * Drops whatever is still queued.
   *
   * A new run does not inherit the last one's orders. A test abandoned during
   * a reversal leaves a shift waiting behind the landing, and without this it
   * is thrown partway through the next run's opening move.
   */
  clear(): void {
    this.orders.length = 0;
  }

  /** Puts it somewhere at once, for reduced motion. */
  place(at: number): void {
    this.journey.snap(at);
    this.travel.held = false;
    this.travel.moveTo(at);
    this.orders.length = 0;
  }

  update(dt: number): void {
    if (!this.journey.running) return;
    const arrived = this.journey.update(dt);
    this.travel.moveTo(this.journey.value);
    if (!arrived) return;
    this.travel.held = false;
    // Drain until something starts moving again, so an order with nowhere to
    // go hands on to the next rather than stranding it for a later journey.
    while (this.orders.length > 0 && !this.journey.running) {
      this.orders.shift()?.();
    }
  }
}
