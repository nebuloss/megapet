import { clamp, lerp, toDegrees, toRadians } from '../../../mech';
import { approach, easeInOut, limitStep } from '../../primitives/anim';
import { icon, type IconName } from '../../primitives/icons';
import { EASE_TAU, SWEEP_MS, sweepMs, toFraction } from '../scale';
import { formatReadout, type Drive, type GaugeAccent, type SpeedVisual } from '../visual';
import {
  ARC_LENGTH,
  CAR,
  CAR_BOTTOM,
  CAR_REST,
  DRIVE_RATIO,
  LAND_MS,
  rideMs,
  HUB,
  LAY,
  RING_LENGTH,
  SHIFT_MS,
  START_ANGLE,
  SWEEP,
  SWEEP_RAD,
} from './layout';
import { Car } from './machine/car';
import { hoist } from './machine/hoist';
import { ReversingGear, reversingParts } from './machine/reversing';
import { SvgScene } from './machine/scene';
import { liftMarkup } from './markup';

const ACCENTS: Record<GaugeAccent, string> = {
  primary: 'var(--md-sys-color-primary)',
  secondary: 'var(--md-sys-color-secondary)',
  tertiary: 'var(--md-sys-color-tertiary)',
};

let instanceCount = 0;

/**
 * The dial and the lift as one machine, reversed by crossing a belt.
 *
 * Two things follow from that choice and they are the whole point. Nothing
 * meshes or unmeshes, so no part can ever be drawn through another; and while
 * the belt is mid-shift the sheave is held by its brake, so the car is
 * genuinely disconnected from the needle instead of being yanked about by it.
 */
export class LiftVisual implements SpeedVisual {
  readonly root: HTMLElement;

  readonly transitionMs = LAND_MS + SHIFT_MS + 250;

  private readonly svg: SVGSVGElement;
  /** Where the machine's positions go. The only object that knows the DOM. */
  private readonly scene: SvgScene;
  private readonly numberEl: HTMLElement;
  private readonly unitEl: HTMLElement;
  private readonly phaseEl: HTMLElement;

  /**
   * The car, and the shaft read off it.
   *
   * Its position is carried, never computed from the reading: a formula like
   * `anchor + sign * fraction * travel` teleports it the moment the sign
   * flips, because the eased reading has not caught up yet. The machine takes
   * it over whenever it moves it itself — home before a run, up the shaft
   * while the ping is taken, into a floor when a leg ends — and the belt has
   * no say while it does.
   */
  private readonly car = new Car();
  private readonly shaft = hoist(this.car, () => this.shownFraction);

  /**
   * The reversing gear, and everything it moves.
   *
   * One number moves: how far through its throw the fork is. The belt's
   * crossing, the lever, the bear's grip on it, the brake and the detent are
   * all read off that at different stages, so they cannot drift apart.
   */
  private readonly gear = new ReversingGear();
  private readonly linkage = reversingParts(this.gear, () => this.car.position);

  /** Eased reading, in Mbps. The needle and the gear pair follow it. */
  private shown = 0;
  private target = 0;
  private lastFraction = 0;

  /** Needle position, 0..1. Eased here rather than in Mbps — see `toFraction`. */
  private shownFraction = 0;
  /** Where the needle is heading, 0..1. Converted when the target is set, so
   *  the frame loop stays free of transcendental maths. */
  private aimFraction = 0;

  private driveSign = -1;

  /** A scripted sweep of the needle back to its stop, 0..1; 1 when idle. */
  private returnT = 1;
  private returnFrom = 0;
  private returnShown = 0;
  private returnMs = SWEEP_MS;

  private reading: number | null = null;
  private unit = 'Mbps';
  private frame = 0;
  private dead = false;
  private lastFrameAt = 0;

  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor() {
    this.root = document.createElement('figure');
    this.root.className = 'lift';
    this.root.dataset.drive = 'up';

    const host = document.createElement('div');
    host.className = 'lift__stage';
    host.innerHTML = liftMarkup(`lift-shaft-${++instanceCount}`);
    this.root.append(host);
    this.svg = host.querySelector('svg')!;
    this.scene = new SvgScene(this.root, this.svg);

    this.numberEl = document.createElement('div');
    this.numberEl.className = 'gauge__number tnum';
    this.numberEl.textContent = '0.00';
    this.unitEl = document.createElement('div');
    this.unitEl.className = 'gauge__unit';
    this.unitEl.textContent = this.unit;
    this.phaseEl = document.createElement('div');
    this.phaseEl.className = 'gauge__phase';
    this.phaseEl.dataset.visible = 'false';

    const readout = document.createElement('figcaption');
    readout.className = 'lift__readout';
    readout.append(this.numberEl, this.unitEl, this.phaseEl);
    this.root.append(readout);

    this.paint();
  }

  // ------------------------------------------------------------- controls --

  setPosition(mbps: number): void {
    this.aim(Number.isFinite(mbps) && mbps > 0 ? mbps : 0);
    if (this.reducedMotion.matches) {
      this.shown = this.target;
      this.turn(this.aimFraction - this.shownFraction);
      this.shownFraction = this.lastFraction = this.aimFraction;
      this.paint();
      return;
    }
    this.startLoop();
  }

  setReading(value: number | null, unit: string): void {
    this.reading = value;
    this.unit = unit;
    this.paint();
  }

  setDrive(direction: Drive): void {
    const sign = direction === 'down' ? 1 : -1;
    if (sign === this.driveSign) return;
    this.driveSign = sign;
    this.root.dataset.drive = direction;

    if (this.reducedMotion.matches) {
      this.gear.seat(direction);
      this.paint();
      return;
    }
    // The reversing gear cannot be thrown while the car is still running. If it
    // is finishing its run into a floor, the shift queues behind it.
    this.car.order(() => this.gear.begin(direction));
    this.startLoop();
  }

  /**
   * Brings the car's run to a proper end: the machine drives it the rest of
   * the way into whichever floor it was heading for and levels it there.
   */
  land(): void {
    if (this.reducedMotion.matches) {
      this.car.place(this.driveSign > 0 ? CAR_BOTTOM : CAR.top);
      this.paint();
      return;
    }
    this.car.land(this.driveSign);
    this.startLoop();
  }

  /**
   * Calls the car up to the top of the shaft, and says how long it will take.
   *
   * This runs while the ping is taken: the phase is otherwise a still picture,
   * and a lift being called up is what a lift does before it carries anything.
   */
  open(): number {
    return this.ride(CAR.top);
  }

  /** Returns the car to the ground floor once the run is over. */
  park(): void {
    this.ride(CAR_REST);
  }

  /**
   * A journey at lift speed, queued behind whatever the machine is already
   * doing rather than cutting it short. Returns how long it will take.
   */
  private ride(to: number): number {
    if (this.reducedMotion.matches) {
      this.car.place(to);
      this.paint();
      return 0;
    }
    const ms = rideMs(Math.abs(to - this.car.destination));
    this.car.order(() => this.car.rideTo(to));
    this.startLoop();
    return ms;
  }

  settleMs(): number {
    const swing = this.returnT < 1 ? (1 - this.returnT) * this.returnMs : 0;
    return Math.round(Math.max(this.car.busyMs, swing));
  }

  reset(): void {
    // Back to the resting colour. The upload leaves the machine on the
    // tertiary accent, and nothing else puts it back.
    this.setAccent('primary');
    this.aim(0);
    this.reading = null;
    this.driveSign = -1;
    this.root.dataset.drive = 'up';
    this.gear.seat('up');
    this.setProgress(0);
    // Nothing queued from the last run survives into this one.
    this.car.clear();

    if (this.reducedMotion.matches) {
      this.shown = 0;
      this.shownFraction = 0;
      this.lastFraction = 0;
      this.car.place(CAR_REST);
    } else {
      // The hold has two jobs and must be long enough for both. It has to
      // outlast the needle's fall, because the needle turns the sheave through
      // the belt and would otherwise drag the car back up the shaft. And it has
      // to be long enough for the distance, or the car is thrown home: pressing
      // Start while the car was still parking after a slow upload sized this
      // from a 200ms fall and moved it 19.9 units in one frame, against a
      // budget of 6.4.
      //
      // A hold with nowhere to go is still a hold, so the fall cannot reach the
      // car — but a first run has neither a fall to outlast nor a distance to
      // cover, and must not be made to wait for one.
      const fall = this.shownFraction > 0 ? this.returnMs : 0;
      if (fall > 0 || Math.abs(CAR_REST - this.car.position) >= 0.5) this.car.home(fall);
    }
    this.startLoop();
    this.paint();
  }

  setProgress(fraction: number): void {
    this.scene.attr(
      'ringArc',
      'stroke-dashoffset',
      String(RING_LENGTH * (1 - clamp(fraction, 0, 1))),
    );
  }

  setAccent(accent: GaugeAccent): void {
    this.root.style.setProperty('--lift-accent', ACCENTS[accent]);
  }

  setPhase(label: string | null, iconName?: IconName): void {
    if (!label) {
      this.phaseEl.dataset.visible = 'false';
      return;
    }
    this.phaseEl.innerHTML = iconName ? icon(iconName) : '';
    this.phaseEl.append(document.createTextNode(label));
    this.phaseEl.dataset.visible = 'true';
  }

  setActive(active: boolean): void {
    this.root.dataset.active = String(active);
  }

  destroy(): void {
    // Terminal. `frame` alone cannot mean this, because startLoop's guard is
    // `if (this.frame) return` — so any later setPosition would restart the
    // loop on a detached tree and animate it forever.
    this.dead = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  // ---------------------------------------------------------------- motion --

  /** Sets the target and its scale position together; they must never drift. */
  private aim(mbps: number): void {
    this.target = mbps;
    const next = toFraction(mbps);
    if (next === 0 && this.aimFraction > 0 && !this.reducedMotion.matches) {
      // Only on the way down to the stop, and only once: the reversing phase
      // re-sends zero ten times a second and must not restart the sweep.
      this.returnFrom = this.shownFraction;
      this.returnShown = this.shown;
      // At one speed, so a needle near the stop drops back quickly and one at
      // full scale takes the whole sweep.
      this.returnMs = sweepMs(this.shownFraction);
      this.returnT = 0;
    } else if (next > 0) {
      this.returnT = 1;
    }
    this.aimFraction = next;
  }

  /**
   * Hands the needle's move to the rope, in radians of sheave.
   *
   * Offered every frame and either used or dropped, never accumulated: a delta
   * saved up while the car is held arrives all at once the moment it is let go.
   */
  private turn(delta: number): void {
    this.car.drive(this.driveSign * delta * DRIVE_RATIO * SWEEP_RAD);
  }

  private startLoop(): void {
    if (this.dead || this.frame) return;
    this.lastFrameAt = 0;
    const step = (now: number): void => {
      const dt = this.lastFrameAt ? Math.min(64, now - this.lastFrameAt) : 16;
      this.lastFrameAt = now;

      const aim = this.aimFraction;
      const before = this.shownFraction;
      if (this.returnT < 1) {
        // Swinging back to the stop: a fixed sweep, with the readout falling on
        // the same curve so the number and the needle stay together.
        this.returnT = Math.min(1, this.returnT + dt / this.returnMs);
        const swing = easeInOut(this.returnT);
        this.shownFraction = lerp(this.returnFrom, 0, swing);
        this.shown = lerp(this.returnShown, 0, swing);
      } else {
        // The exponential decides the shape, the limit decides the speed.
        const wanted = approach(this.shownFraction, aim, dt, EASE_TAU) - this.shownFraction;
        const allowed = limitStep(wanted, dt, SWEEP_MS);
        this.shownFraction += allowed;
        // The readout is held back by the same proportion, so the number and
        // the needle never disagree about where the reading has got to.
        const ratio = wanted === 0 ? 1 : allowed / wanted;
        this.shown += (approach(this.shown, this.target, dt, EASE_TAU) - this.shown) * ratio;
      }
      const moved = this.shownFraction - this.lastFraction;
      this.lastFraction = this.shownFraction;

      this.gear.update(dt);
      // The brake holds the sheave for the whole throw, so the needle's move
      // reaches nothing; the car declines it too while the machine has it.
      if (!this.gear.holding) this.turn(moved);
      this.car.update(dt);

      const settled =
        Math.abs(aim - before) < 0.0005 &&
        !this.gear.throwing &&
        this.returnT === 1 &&
        this.car.free;
      if (settled) {
        this.shown = this.target;
        this.turn(aim - this.shownFraction);
        this.shownFraction = this.lastFraction = aim;
      }
      this.paint();

      if (settled) {
        this.frame = 0;
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private paint(): void {
    const fraction = this.shownFraction;

    // --- the gear pair the needle turns, permanently in mesh ---
    const hubPhase = toRadians(START_ANGLE + fraction * SWEEP);
    const layPhase = -hubPhase * (HUB.teeth / LAY.teeth);
    this.scene.transform('hub', `rotate(${toDegrees(hubPhase).toFixed(2)})`);
    this.scene.transform('lay', `rotate(${toDegrees(layPhase).toFixed(2)})`);

    this.linkage.place(this.scene);
    this.shaft.place(this.scene);
    this.scene.attr('valueArc', 'stroke-dashoffset', String(ARC_LENGTH * (1 - fraction)));
    this.scene.quantity('lift-effort', fraction.toFixed(3));

    // The unit is chosen with the number, so a gigabit link reads 8.74 Gbps
    // rather than 8741, and a slow one keeps its digits.
    const reading = formatReadout(this.reading ?? this.shown, this.unit);
    this.numberEl.textContent = reading.value;
    if (this.unitEl.textContent !== reading.unit) this.unitEl.textContent = reading.unit;
  }
}
