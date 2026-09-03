import {
  bearing,
  clamp,
  detentLift,
  drumPin,
  lerp,
  polar,
  reversePhase,
  seatTakeUp,
  springOutline,
  swingPhase,
  toDegrees,
  toRadians,
  wrapTau,
  type Seat,
} from '../../mech';
import { approach, easeInOut, easeOutBack, stage } from '../anim';
import { icon, type IconName } from '../icons';
import { toFraction } from '../scale';
import { readoutText, type Drive, type GaugeAccent, type SpeedVisual } from '../visual';
import {
  ARC_LENGTH,
  CAR,
  CAR_BOTTOM,
  EASE_TAU,
  HUB,
  LEVER,
  PAWL_ANGLE,
  PAWL_LIFT,
  PAWL_WIDTH,
  PULLEY,
  RING_LENGTH,
  ROPE_PIN_BASE,
  ROPE_RUN_X,
  ROPE_TANGENT,
  SHEAVE,
  SHIFT_DRUM_R,
  SHIFT_MS,
  SPRING_ANCHOR,
  SPRING_PIN_BASE,
  SPRING_PIN_R,
  STAGE,
  START_ANGLE,
  SWEEP,
  TRAIN,
  TRAVEL,
  WEIGHT,
  YOKE_DOWN,
  YOKE_UP,
} from './layout';
import { liftMarkup } from './markup';
import { armTransform } from './nookie';

const ACCENTS: Record<GaugeAccent, string> = {
  primary: 'var(--md-sys-color-primary)',
  secondary: 'var(--md-sys-color-secondary)',
  tertiary: 'var(--md-sys-color-tertiary)',
};

let instanceCount = 0;

/**
 * The dial and the lift as one machine, reversed by a tumbler gearbox that
 * Nookies shifts by hand. The mechanism itself lives in `../../mech`; this
 * class is the scene: it holds the eased state, runs the throw's stages in
 * order, and writes the results into the SVG.
 */
export class LiftScene implements SpeedVisual {
  readonly root: HTMLElement;

  /** The shift, plus a beat to look at it before the next phase loads up. */
  readonly transitionMs = SHIFT_MS + 250;

  private readonly svg: SVGSVGElement;
  private readonly nodes: {
    car: SVGGElement;
    weight: SVGGElement;
    carRope: SVGLineElement;
    weightRope: SVGLineElement;
    yoke: SVGGElement;
    shifter: SVGGElement;
    lever: SVGGElement;
    rope: SVGPathElement;
    spring: SVGPathElement;
    pawl: SVGGElement;
    hub: SVGGElement;
    swing: SVGGElement;
    reverse: SVGGElement;
    sheave: SVGGElement;
    valueArc: SVGPathElement;
    ringArc: SVGPathElement;
    waveArm: SVGGElement;
  };
  private readonly numberEl: HTMLElement;
  private readonly unitEl: HTMLElement;
  private readonly phaseEl: HTMLElement;

  /** Eased reading, in Mbps. The needle and the whole train follow it. */
  private shown = 0;
  private target = 0;

  /** Progress through a shift, on its own clock so the stages keep order. */
  private shiftT = 1;
  private yokeAngle = YOKE_UP;
  private leverAngle = LEVER.seatUp;
  private shiftFromYoke = YOKE_UP;
  private shiftToYoke = YOKE_UP;
  private shiftFromLever = LEVER.seatUp;
  private shiftToLever = LEVER.seatUp;

  /** Sheave rotation taken up when a stationary train is engaged. */
  private takeUp = 0;
  private takeUpTarget = 0;
  private takeUpSolved = false;

  private anchor = CAR.top;
  private driveSign = -1;
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
      yoke: find('.lift__yoke'),
      shifter: find('.lift__shifter'),
      lever: find('.lift__lever'),
      rope: find('.lift__rope'),
      spring: find('.lift__spring'),
      pawl: find('.lift__pawl'),
      hub: find('.lift__gear--hub .lift__gear-spin'),
      swing: find('.lift__gear--swing .lift__gear-spin'),
      reverse: find('.lift__gear--reverse .lift__gear-spin'),
      sheave: find('.lift__gear--sheave .lift__gear-spin'),
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
    this.target = Number.isFinite(mbps) && mbps > 0 ? mbps : 0;
    if (this.reducedMotion.matches) {
      this.shown = this.target;
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

    // Fold any take-up so far into the anchor, then re-anchor on where the car
    // is: the next phase starts from zero, so shifting does not move it.
    this.anchor = this.carTopFor(toFraction(this.target));
    this.takeUp = 0;
    this.takeUpTarget = 0;
    this.takeUpSolved = false;
    this.driveSign = sign;
    this.root.dataset.drive = direction;

    const yokeSeat = direction === 'down' ? YOKE_DOWN : YOKE_UP;
    const leverSeat = direction === 'down' ? LEVER.seatDown : LEVER.seatUp;

    if (this.reducedMotion.matches) {
      this.seat(yokeSeat, leverSeat);
      this.paint();
      return;
    }
    this.shiftFromYoke = this.yokeAngle;
    this.shiftFromLever = this.leverAngle;
    this.shiftToYoke = yokeSeat;
    this.shiftToLever = leverSeat;
    this.shiftT = 0;
    this.root.dataset.shifting = 'true';
    this.startLoop();
  }

  private seat(yokeSeat: number, leverSeat: number): void {
    this.shiftT = 1;
    this.yokeAngle = yokeSeat;
    this.leverAngle = leverSeat;
    this.shiftFromYoke = this.shiftToYoke = yokeSeat;
    this.shiftFromLever = this.shiftToLever = leverSeat;
    this.takeUp = 0;
    this.takeUpTarget = 0;
    this.takeUpSolved = true;
    this.root.dataset.shifting = 'false';
  }

  reset(): void {
    this.target = 0;
    this.shown = 0;
    this.reading = null;
    this.anchor = CAR.top;
    this.driveSign = -1;
    this.root.dataset.drive = 'up';
    this.seat(YOKE_UP, LEVER.seatUp);
    this.setProgress(0);
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

  private carTopFor(fraction: number): number {
    return clamp(
      this.anchor + this.driveSign * fraction * TRAVEL - this.takeUp * SHEAVE.radius,
      CAR.top,
      CAR_BOTTOM,
    );
  }

  private get seatName(): Seat {
    return this.driveSign < 0 ? 'direct' : 'reversed';
  }

  private startLoop(): void {
    if (this.frame) return;
    this.lastFrameAt = 0;
    const step = (now: number): void => {
      const dt = this.lastFrameAt ? Math.min(64, now - this.lastFrameAt) : 16;
      this.lastFrameAt = now;

      const before = this.shown;
      this.shown = approach(this.shown, this.target, dt, EASE_TAU);

      if (this.shiftT < 1) {
        this.shiftT = Math.min(1, this.shiftT + dt / SHIFT_MS);
        if (this.shiftT === 1) this.root.dataset.shifting = 'false';
      }

      const settled = Math.abs(this.target - before) < 0.005 && this.shiftT === 1;
      if (settled) this.shown = this.target;
      this.paint();

      if (settled) {
        this.frame = 0;
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /**
   * The control rope, drawn taut: lever pin, out to the car's outrigger, up the
   * shaft, tangent onto the guide pulley, round it, tangent onto the shift drum
   * and round to the pin it is made off at.
   */
  private ropeShape(carTop: number, leverDegrees: number, yokeDegrees: number): string {
    const lever = toRadians(leverDegrees);
    const pin = {
      x: LEVER.x + LEVER.arm * Math.sin(lever),
      y: carTop + LEVER.y - LEVER.arm * Math.cos(lever),
    };
    const madeOff = drumPin(HUB, SHIFT_DRUM_R, toRadians(ROPE_PIN_BASE), toRadians(yokeDegrees));
    const wrap = wrapTau(bearing(HUB, madeOff) - bearing(HUB, ROPE_TANGENT));
    const leavesPulley = polar(
      PULLEY,
      PULLEY.r,
      bearing(PULLEY, ROPE_TANGENT) - Math.acos(PULLEY.r / Math.hypot(ROPE_TANGENT.x - PULLEY.x, ROPE_TANGENT.y - PULLEY.y)),
    );

    return (
      `M ${pin.x.toFixed(2)} ${pin.y.toFixed(2)}` +
      ` L 89 ${(carTop + 9).toFixed(2)}` +
      ` L ${CAR.x - CAR.w / 2} ${(carTop + 14).toFixed(2)}` +
      ` L ${ROPE_RUN_X.toFixed(2)} ${(carTop + 14).toFixed(2)}` +
      ` L ${ROPE_RUN_X.toFixed(2)} ${PULLEY.y.toFixed(2)}` +
      ` A ${PULLEY.r} ${PULLEY.r} 0 0 1 ${leavesPulley.x.toFixed(2)} ${leavesPulley.y.toFixed(2)}` +
      ` L ${ROPE_TANGENT.x.toFixed(2)} ${ROPE_TANGENT.y.toFixed(2)}` +
      ` A ${SHIFT_DRUM_R} ${SHIFT_DRUM_R} 0 ${wrap > Math.PI ? 1 : 0} 1 ${madeOff.x.toFixed(2)} ${madeOff.y.toFixed(2)}`
    );
  }

  private paint(): void {
    const fraction = toFraction(this.shown);
    const shift = this.shiftT;

    // --- the throw: lever, then yoke, then the gears take up ---
    this.leverAngle = lerp(
      this.shiftFromLever,
      this.shiftToLever,
      easeOutBack(stage(shift, STAGE.lever)),
    );
    this.yokeAngle = lerp(
      this.shiftFromYoke,
      this.shiftToYoke,
      easeOutBack(stage(shift, STAGE.yoke)),
    );
    const grip =
      easeInOut(stage(shift, STAGE.reach)) * (1 - easeInOut(stage(shift, STAGE.release)));

    const yokeRad = toRadians(this.yokeAngle);
    const hubPhase = toRadians(START_ANGLE + fraction * SWEEP);

    // --- the car, and the sheave rotation that positions it ---
    const carTop = this.carTopFor(fraction);
    const sheavePhase = (CAR.top - carTop) / SHEAVE.radius;

    if (!this.takeUpSolved && stage(shift, STAGE.takeUp) > 0) {
      this.takeUpTarget = seatTakeUp(TRAIN, this.seatName, hubPhase, sheavePhase);
      this.takeUpSolved = true;
    }
    this.takeUp = this.takeUpTarget * easeOutBack(stage(shift, STAGE.takeUp));

    // --- gear phases, each one indexed to its neighbour ---
    const swingP = swingPhase(TRAIN, hubPhase, yokeRad);
    this.nodes.hub.setAttribute('transform', `rotate(${toDegrees(hubPhase).toFixed(2)})`);
    // The swing gear is drawn inside the yoke, so subtract the carrier's turn.
    this.nodes.swing.setAttribute(
      'transform',
      `rotate(${(toDegrees(swingP) - this.yokeAngle).toFixed(2)})`,
    );
    this.nodes.sheave.setAttribute('transform', `rotate(${toDegrees(sheavePhase).toFixed(2)})`);
    this.nodes.reverse.setAttribute(
      'transform',
      `rotate(${toDegrees(reversePhase(TRAIN, sheavePhase)).toFixed(2)})`,
    );

    const yokeTransform = `rotate(${this.yokeAngle.toFixed(2)} ${HUB.x} ${HUB.y})`;
    this.nodes.yoke.setAttribute('transform', yokeTransform);
    this.nodes.shifter.setAttribute('transform', yokeTransform);
    this.nodes.lever.setAttribute(
      'transform',
      `rotate(${this.leverAngle.toFixed(2)} ${LEVER.x} ${LEVER.y})`,
    );
    this.nodes.waveArm.style.transform =
      grip > 0.002 ? armTransform(this.leverAngle, grip) : '';

    // --- detent: the roller rides out of one notch and drops into the other ---
    const lift = detentLift(this.yokeAngle, [YOKE_UP, YOKE_DOWN], PAWL_LIFT, PAWL_WIDTH);
    const pawlDir = toRadians(PAWL_ANGLE);
    this.nodes.pawl.setAttribute(
      'transform',
      `translate(${(Math.cos(pawlDir) * lift).toFixed(2)} ${(Math.sin(pawlDir) * lift).toFixed(2)})`,
    );

    // --- rope and return spring ---
    this.nodes.rope.setAttribute('d', this.ropeShape(carTop, this.leverAngle, this.yokeAngle));
    const springPin = drumPin(HUB, SPRING_PIN_R, toRadians(SPRING_PIN_BASE), yokeRad);
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
