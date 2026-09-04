import {
  bearing,
  clamp,
  detentLift,
  drumPin,
  lerp,
  polar,
  springOutline,
  strands,
  tangentPoint,
  toDegrees,
  toRadians,
  wrapTau,
} from '../../../mech';
import { approach, easeInOut, easeOutBack, limitStep, stage } from '../../primitives/anim';
import { icon, type IconName } from '../../primitives/icons';
import { EASE_TAU, SWEEP_MS, sweepMs, toFraction } from '../scale';
import { formatReadout, type Drive, type GaugeAccent, type SpeedVisual } from '../visual';
import {
  ARC_LENGTH,
  BRAKE,
  CAR,
  CAR_BOTTOM,
  CAR_REST,
  DRIVE,
  DRIVEN,
  DRIVE_RATIO,
  LAND_MS,
  rideMs,
  FORK,
  HUB,
  LAY,
  LEVER,
  PAWL_ANGLE,
  PAWL_LIFT,
  PAWL_WIDTH,
  PULLEY,
  RING_LENGTH,
  ROPE_PIN_BASE,
  ROPE_RUN_X,
  SHIFT_DRUM_R,
  SHIFT_MS,
  SPRING_ANCHOR,
  SPRING_PIN_BASE,
  SPRING_PIN_R,
  STAGE,
  START_ANGLE,
  SWEEP,
  SWEEP_RAD,
} from './layout';
import { Car } from './machine/car';
import { hoist } from './machine/hoist';
import { SvgScene } from './machine/scene';
import { liftMarkup } from './markup';
import { armTransform } from './nookie';
const ACCENTS: Record<GaugeAccent, string> = {
  primary: 'var(--md-sys-color-primary)',
  secondary: 'var(--md-sys-color-secondary)',
  tertiary: 'var(--md-sys-color-tertiary)',
};

/** Crossed belt drives the car up; open belt drives it down. */
const CROSS_FOR: Record<Drive, number> = { up: 1, down: 0 };

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

  private shiftT = 1;
  private cross = CROSS_FOR.up;
  private crossFrom = CROSS_FOR.up;
  private crossTo = CROSS_FOR.up;
  private leverAngle = LEVER.seatUp;
  private leverFrom = LEVER.seatUp;
  private leverTo = LEVER.seatUp;

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
    this.root.dataset.shifting = 'false';

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
      this.seat(CROSS_FOR[direction], direction === 'down' ? LEVER.seatDown : LEVER.seatUp);
      this.paint();
      return;
    }
    // The reversing gear cannot be thrown while the car is still running. If it
    // is finishing its run into a floor, the shift queues behind it.
    this.car.order(() => this.beginShift(direction));
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

  private beginShift(direction: Drive): void {
    this.crossFrom = this.cross;
    this.crossTo = CROSS_FOR[direction];
    this.leverFrom = this.leverAngle;
    this.leverTo = direction === 'down' ? LEVER.seatDown : LEVER.seatUp;
    this.shiftT = 0;
    this.root.dataset.shifting = 'true';
    this.startLoop();
  }

  private seat(cross: number, lever: number): void {
    this.shiftT = 1;
    this.cross = this.crossFrom = this.crossTo = cross;
    this.leverAngle = this.leverFrom = this.leverTo = lever;
    this.root.dataset.shifting = 'false';
  }

  reset(): void {
    // Back to the resting colour. The upload leaves the machine on the
    // tertiary accent, and nothing else puts it back.
    this.setAccent('primary');
    this.aim(0);
    this.reading = null;
    this.driveSign = -1;
    this.root.dataset.drive = 'up';
    this.seat(CROSS_FOR.up, LEVER.seatUp);
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
    this.shiftT = 1;
    this.root.dataset.shifting = 'false';
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

      if (this.shiftT < 1) {
        this.shiftT = Math.min(1, this.shiftT + dt / SHIFT_MS);
        if (this.shiftT === 1) this.root.dataset.shifting = 'false';
      }
      // The brake holds the sheave for the whole throw, so the needle's move
      // reaches nothing; the car itself declines it while the machine has it.
      if (this.shiftT >= 1) this.turn(moved);
      this.car.update(dt);

      const settled =
        Math.abs(aim - before) < 0.0005 &&
        this.shiftT === 1 &&
        this.returnT === 1 &&
        this.car.free;
      if (settled) {
        this.shown = this.target;
        this.turn(aim - this.shownFraction);
        this.shownFraction = aim;
        this.lastFraction = aim;
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

  /** One strand of the belt, bowed by however slack it is mid-shift. */
  private strandShape(
    from: { x: number; y: number },
    to: { x: number; y: number },
    slack: number,
  ): string {
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

  /** Control rope: lever pin, car outrigger, up the shaft, over the guide pulley, onto the fork drum. */
  private ropeShape(carTop: number, leverDegrees: number, forkDegrees: number): string {
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

  private paint(): void {
    const fraction = this.shownFraction;
    const shift = this.shiftT;

    // --- the throw ---
    const crossProgress = easeInOut(stage(shift, STAGE.cross));
    this.cross = lerp(this.crossFrom, this.crossTo, crossProgress);
    this.leverAngle = lerp(this.leverFrom, this.leverTo, easeOutBack(stage(shift, STAGE.lever)));
    const grip = easeInOut(stage(shift, STAGE.reach)) * (1 - easeInOut(stage(shift, STAGE.release)));
    const braked = clamp(
      easeInOut(stage(shift, STAGE.brake)) - easeInOut(stage(shift, STAGE.unbrake)),
      0,
      1,
    );

    // --- rotations ---
    const hubPhase = toRadians(START_ANGLE + fraction * SWEEP);
    const layPhase = -hubPhase * (HUB.teeth / LAY.teeth);
    this.scene.transform('hub', `rotate(${toDegrees(hubPhase).toFixed(2)})`);
    this.scene.transform('lay', `rotate(${toDegrees(layPhase).toFixed(2)})`);

    // --- the belt, and the fork walking it across ---
    const slack = Math.sin(Math.PI * clamp(crossProgress, 0, 1));
    const [a, b] = strands(DRIVE, DRIVEN, this.cross);
    this.scene.path('beltA', this.strandShape(a.from, a.to, slack));
    this.scene.path('beltB', this.strandShape(b.from, b.to, -slack));

    const forkAngle = FORK.open + this.cross * (FORK.crossed - FORK.open);
    this.scene.transform('shifter', `rotate(${forkAngle.toFixed(2)} ${FORK.x} ${FORK.y})`);
    this.scene.transform('lever', `rotate(${this.leverAngle.toFixed(2)} ${LEVER.x} ${LEVER.y})`);
    this.scene.transform('arm', grip > 0.002 ? armTransform(this.leverAngle, grip) : '');

    // --- brake, detent, rope, spring ---
    const brakeDir = toRadians(BRAKE.angle);
    this.scene.transform(
      'brakeShoe',
      `translate(${(-Math.cos(brakeDir) * BRAKE.lift * braked).toFixed(2)} ${(-Math.sin(brakeDir) * BRAKE.lift * braked).toFixed(2)})`,
    );
    this.scene.flag('braked', braked > 0.5);

    const lift = detentLift(forkAngle, [FORK.open, FORK.crossed], PAWL_LIFT, PAWL_WIDTH);
    const pawlDir = toRadians(PAWL_ANGLE);
    this.scene.transform(
      'pawl',
      `translate(${(Math.cos(pawlDir) * lift).toFixed(2)} ${(Math.sin(pawlDir) * lift).toFixed(2)})`,
    );

    this.scene.path('rope', this.ropeShape(this.car.position, this.leverAngle, forkAngle));
    const springPin = drumPin(FORK, SPRING_PIN_R, toRadians(SPRING_PIN_BASE), toRadians(forkAngle));
    this.scene.path('spring', springOutline(SPRING_ANCHOR, springPin));

    // --- the shaft, and the dial ---
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
