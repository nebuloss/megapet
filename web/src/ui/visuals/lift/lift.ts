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
import { approach, easeInOut, easeOutBack, stage } from '../../primitives/anim';
import { icon, type IconName } from '../../primitives/icons';
import { toFraction } from '../scale';
import { readoutText, type Drive, type GaugeAccent, type SpeedVisual } from '../visual';
import {
  ARC_LENGTH,
  BRAKE,
  CAR,
  CAR_BOTTOM,
  DRIVE,
  DRIVEN,
  EASE_TAU,
  HOME_MS,
  LAND_MS,
  RETURN_MS,
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
  SHEAVE,
  SHIFT_DRUM_R,
  SHIFT_MS,
  SPRING_ANCHOR,
  SPRING_PIN_BASE,
  SPRING_PIN_R,
  STAGE,
  START_ANGLE,
  SWEEP,
  WEIGHT,
} from './layout';
import { carriageTop } from './carriage';
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
  private readonly nodes: {
    car: SVGGElement;
    weight: SVGGElement;
    carRope: SVGLineElement;
    weightRope: SVGLineElement;
    beltA: SVGPathElement;
    beltB: SVGPathElement;
    shifter: SVGGElement;
    brakeShoe: SVGGElement;
    lever: SVGGElement;
    rope: SVGPathElement;
    spring: SVGPathElement;
    pawl: SVGGElement;
    hub: SVGGElement;
    lay: SVGGElement;
    sheave: SVGGElement;
    valueArc: SVGPathElement;
    ringArc: SVGPathElement;
    waveArm: SVGGElement;
  };
  private readonly numberEl: HTMLElement;
  private readonly unitEl: HTMLElement;
  private readonly phaseEl: HTMLElement;

  /** Eased reading, in Mbps. The needle and the gear pair follow it. */
  private shown = 0;
  private target = 0;
  private lastFraction = 0;

  /**
   * The car's position is carried, not computed from the reading. That is what
   * makes reversing safe: the direction of travel can change without the car
   * being asked to jump to wherever a new formula would put it.
   */
  /** Needle position, 0..1. Eased here rather than in Mbps — see `toFraction`. */
  private shownFraction = 0;
  /** Where the needle is heading, 0..1. Converted when the target is set, so
   *  the frame loop stays free of transcendental maths. */
  private aimFraction = 0;

  private carTop = CAR.top;
  private driveSign = -1;

  /**
   * Progress of the return to the top floor before a run, 0..1; 1 when idle.
   *
   * Resetting used to assign carTop and shown directly, which teleported the
   * car and snapped the needle the moment Start was pressed on a second run.
   * The machine drives it home instead, and integration is suspended while it
   * does — the same reason the brake suspends it during a belt shift. Landing
   * at the end of a phase uses the same mechanism with a different floor.
   */
  private glideT = 1;
  private glideFrom = CAR.top;
  private glideTo = CAR.top;
  private glideMs = HOME_MS;

  /** A scripted sweep of the needle back to its stop, 0..1; 1 when idle. */
  private returnT = 1;
  private returnFrom = 0;
  private returnShown = 0;

  /** A direction change waiting for the car to stop before the gear is shifted. */
  private pendingDrive: Drive | null = null;

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

    const find = <T extends SVGElement>(selector: string): T =>
      this.svg.querySelector<T>(selector)!;
    this.nodes = {
      car: find('.lift__car'),
      weight: find('.lift__weight'),
      carRope: find('.lift__cable--car'),
      weightRope: find('.lift__cable--weight'),
      beltA: find('.lift__belt--a'),
      beltB: find('.lift__belt--b'),
      shifter: find('.lift__shifter'),
      brakeShoe: find('.lift__brake-shoe-group'),
      lever: find('.lift__lever'),
      rope: find('.lift__rope'),
      spring: find('.lift__spring'),
      pawl: find('.lift__pawl'),
      hub: find('.lift__gear--hub .lift__gear-spin'),
      lay: find('.lift__gear--lay .lift__gear-spin'),
      sheave: find('.lift__sheave-spin'),
      valueArc: find('.lift__dial-value'),
      ringArc: find('.lift__progress-ring'),
      waveArm: find('.nookie__arm--wave'),
    };

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
    this.shownFraction = this.aimFraction;
      this.paint();
      return;
    }
    this.startLoop();
  }

  setReading(value: number | null, unit: string): void {
    this.reading = value;
    if (unit !== this.unit) {
      this.unit = unit;
      this.unitEl.textContent = unit;
    }
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
    // The reversing gear cannot be shifted while the car is still running.
    // If it is finishing its run into a floor, the shift queues behind it.
    if (this.glideT < 1) {
      this.pendingDrive = direction;
      this.startLoop();
      return;
    }
    this.beginShift(direction);
  }

  /**
   * Brings the car's run to a proper end: the machine drives it the rest of
   * the way into whichever floor it was heading for and levels it there.
   */
  land(): void {
    const floor = this.driveSign > 0 ? CAR_BOTTOM : CAR.top;
    if (this.reducedMotion.matches) {
      this.carTop = floor;
      this.paint();
      return;
    }
    this.startGlide(floor, LAND_MS);
  }

  settleMs(): number {
    const home = this.glideT < 1 ? (1 - this.glideT) * this.glideMs : 0;
    const swing = this.returnT < 1 ? (1 - this.returnT) * RETURN_MS : 0;
    return Math.round(Math.max(home, swing));
  }

  /** Hands the car to the machine for a scripted move; the belt has no say. */
  private startGlide(to: number, ms: number): void {
    this.glideFrom = this.carTop;
    this.glideTo = to;
    this.glideMs = ms;
    // Already there: skip it, or a zero-length move would hold up a shift.
    this.glideT = Math.abs(to - this.carTop) < 0.5 ? 1 : 0;
    this.startLoop();
  }

  private beginShift(direction: Drive): void {
    this.pendingDrive = null;
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
    this.aim(0);
    this.reading = null;
    this.driveSign = -1;
    this.root.dataset.drive = 'up';
    this.seat(CROSS_FOR.up, LEVER.seatUp);
    this.setProgress(0);

    if (this.reducedMotion.matches) {
      this.shown = 0;
      this.shownFraction = 0;
      this.lastFraction = 0;
      this.carTop = CAR.top;
      this.glideT = 1;
    } else {
      if (this.shownFraction > 0) {
        // The needle's fall to the stop turns the sheave through the belt, so
        // the machine holds the car for exactly as long as the fall lasts —
        // even when the car is already home and has nowhere to go.
        this.startGlide(CAR.top, RETURN_MS);
        this.glideT = 0;
      } else {
        this.startGlide(CAR.top, HOME_MS);
      }
    }
    this.pendingDrive = null;
    this.shiftT = 1;
    this.root.dataset.shifting = 'false';
    this.startLoop();
    this.paint();
  }

  setProgress(fraction: number): void {
    this.nodes.ringArc.setAttribute(
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
      this.returnT = 0;
    } else if (next > 0) {
      this.returnT = 1;
    }
    this.aimFraction = next;
  }

  private startLoop(): void {
    if (this.frame) return;
    this.lastFrameAt = 0;
    const step = (now: number): void => {
      const dt = this.lastFrameAt ? Math.min(64, now - this.lastFrameAt) : 16;
      this.lastFrameAt = now;

      const aim = this.aimFraction;
      const before = this.shownFraction;
      if (this.returnT < 1) {
        // Swinging back to the stop: a fixed sweep, with the readout falling on
        // the same curve so the number and the needle stay together.
        this.returnT = Math.min(1, this.returnT + dt / RETURN_MS);
        const swing = easeInOut(this.returnT);
        this.shownFraction = lerp(this.returnFrom, 0, swing);
        this.shown = lerp(this.returnShown, 0, swing);
      } else {
        this.shown = approach(this.shown, this.target, dt, EASE_TAU);
        this.shownFraction = approach(this.shownFraction, aim, dt, EASE_TAU);
      }
      if (this.shiftT < 1) {
        this.shiftT = Math.min(1, this.shiftT + dt / SHIFT_MS);
        if (this.shiftT === 1) this.root.dataset.shifting = 'false';
      }
      if (this.glideT < 1) {
        this.glideT = Math.min(1, this.glideT + dt / this.glideMs);
        if (this.glideT === 1 && this.pendingDrive) this.beginShift(this.pendingDrive);
      }

      const settled =
        Math.abs(aim - before) < 0.0005 &&
        this.shiftT === 1 &&
        this.glideT === 1 &&
        this.returnT === 1 &&
        !this.pendingDrive;
      if (settled) {
        this.shown = this.target;
        this.shownFraction = aim;
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
  private strandShape(from: { x: number; y: number }, to: { x: number; y: number }, slack: number): string {
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
      bearing(PULLEY, tangent) - Math.acos(PULLEY.r / Math.hypot(tangent.x - PULLEY.x, tangent.y - PULLEY.y)),
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
    const shifting = shift < 1;

    // --- the throw ---
    const crossProgress = easeInOut(stage(shift, STAGE.cross));
    this.cross = lerp(this.crossFrom, this.crossTo, crossProgress);
    this.leverAngle = lerp(this.leverFrom, this.leverTo, easeOutBack(stage(shift, STAGE.lever)));
    const grip =
      easeInOut(stage(shift, STAGE.reach)) * (1 - easeInOut(stage(shift, STAGE.release)));
    const braked = clamp(
      easeInOut(stage(shift, STAGE.brake)) - easeInOut(stage(shift, STAGE.unbrake)),
      0,
      1,
    );

    // --- the car: carried, homed before a run, held during a belt shift ---
    this.carTop = carriageTop({
      top: this.carTop,
      fraction,
      lastFraction: this.lastFraction,
      driveSign: this.driveSign,
      held: shifting,
      glide: this.glideT,
      glideFrom: this.glideFrom,
      glideTo: this.glideTo,
    });
    this.lastFraction = fraction;
    const carTop = this.carTop;

    // --- rotations ---
    const hubPhase = toRadians(START_ANGLE + fraction * SWEEP);
    const layPhase = -hubPhase * (HUB.teeth / LAY.teeth);
    const sheavePhase = (CAR.top - carTop) / SHEAVE.radius;
    this.nodes.hub.setAttribute('transform', `rotate(${toDegrees(hubPhase).toFixed(2)})`);
    this.nodes.lay.setAttribute('transform', `rotate(${toDegrees(layPhase).toFixed(2)})`);
    this.nodes.sheave.setAttribute('transform',
      `translate(${SHEAVE.x} ${SHEAVE.y}) rotate(${toDegrees(sheavePhase).toFixed(2)})`);

    // --- the belt, and the fork walking it across ---
    const slack = Math.sin(Math.PI * clamp(crossProgress, 0, 1));
    const [a, b] = strands(DRIVE, DRIVEN, this.cross);
    this.nodes.beltA.setAttribute('d', this.strandShape(a.from, a.to, slack));
    this.nodes.beltB.setAttribute('d', this.strandShape(b.from, b.to, -slack));

    const forkAngle = FORK.open + this.cross * (FORK.crossed - FORK.open);
    this.nodes.shifter.setAttribute('transform', `rotate(${forkAngle.toFixed(2)} ${FORK.x} ${FORK.y})`);
    this.nodes.lever.setAttribute(
      'transform',
      `rotate(${this.leverAngle.toFixed(2)} ${LEVER.x} ${LEVER.y})`,
    );
    this.nodes.waveArm.style.transform =
      grip > 0.002 ? armTransform(this.leverAngle, grip) : '';

    // --- brake, detent, rope, spring ---
    const brakeDir = toRadians(BRAKE.angle);
    this.nodes.brakeShoe.setAttribute(
      'transform',
      `translate(${(-Math.cos(brakeDir) * BRAKE.lift * braked).toFixed(2)} ${(-Math.sin(brakeDir) * BRAKE.lift * braked).toFixed(2)})`,
    );
    this.root.dataset.braked = braked > 0.5 ? 'true' : 'false';

    const lift = detentLift(forkAngle, [FORK.open, FORK.crossed], PAWL_LIFT, PAWL_WIDTH);
    const pawlDir = toRadians(PAWL_ANGLE);
    this.nodes.pawl.setAttribute(
      'transform',
      `translate(${(Math.cos(pawlDir) * lift).toFixed(2)} ${(Math.sin(pawlDir) * lift).toFixed(2)})`,
    );

    this.nodes.rope.setAttribute('d', this.ropeShape(carTop, this.leverAngle, forkAngle));
    const springPin = drumPin(FORK, SPRING_PIN_R, toRadians(SPRING_PIN_BASE), toRadians(forkAngle));
    this.nodes.spring.setAttribute('d', springOutline(SPRING_ANCHOR, springPin));

    // --- car, counterweight, dial ---
    const weightTop = WEIGHT.low - (carTop - CAR.top);
    this.nodes.car.setAttribute('transform', `translate(0 ${carTop.toFixed(2)})`);
    this.nodes.weight.setAttribute('transform', `translate(0 ${weightTop.toFixed(2)})`);
    this.nodes.carRope.setAttribute('y2', carTop.toFixed(2));
    this.nodes.weightRope.setAttribute('y2', weightTop.toFixed(2));
    this.nodes.valueArc.setAttribute('stroke-dashoffset', String(ARC_LENGTH * (1 - fraction)));

    this.root.style.setProperty('--lift-effort', fraction.toFixed(3));
    this.root.style.setProperty('--nookie-bob', `${(2.6 - fraction * 1.8).toFixed(2)}s`);
    this.root.style.setProperty('--streak-duration', `${(1.5 - fraction * 1.15).toFixed(2)}s`);
    this.numberEl.textContent = readoutText(this.reading ?? this.shown, this.unit);
  }
}
