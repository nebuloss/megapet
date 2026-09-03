import { icon, type IconName } from './icons';
import { TICKS, toFraction } from './scale';
import { readoutText, type Drive, type GaugeAccent, type SpeedVisual } from './visual';

/*
 * The speed dial and the lift are one machine, with a reversing gear between
 * them.
 *
 * The needle rides the hub gear. A swing gear on a pivoting yoke always meshes
 * the hub, and the yoke rocks between two seats:
 *
 *   download — the swing gear meets the reverse gear, which meets the drum.
 *              Three meshes, so the drum turns anticlockwise and pays cable
 *              out: the car descends as the download figure climbs.
 *   upload   — the swing gear meets the drum directly. Two meshes, the drum
 *              turns clockwise and winds cable in: the car climbs.
 *
 * That is a lathe tumbler reverse, and it is the whole reason the car can run
 * one way for download and the other for upload without anything jumping: the
 * gear train changes, not the arithmetic.
 *
 * Nookies throws the shift himself, and the linkage is drawn end to end. He
 * pulls the lever in the car; the lever's short end takes up a control rope;
 * the rope runs down the car's outrigger, up the shaft, over a guide pulley
 * and onto a bellcrank on the yoke axle. Pulling it swings the yoke. The
 * stages overlap slightly so the throw reads as one movement travelling
 * through the machine rather than four things happening in turn.
 */

const DIAL = { x: 140, y: 100, radius: 68, width: 10, ringRadius: 77, labelRadius: 88 };
const START_ANGLE = 225;
const SWEEP = 270;
const SWEEP_RAD = (SWEEP * Math.PI) / 180;

/** Hub carries the needle; the drum winds the cable. */
const HUB = { x: DIAL.x, y: DIAL.y, r: 19, teeth: 13, depth: 6 };
const DRUM = { x: DIAL.x, y: 166, r: 26, teeth: 15, depth: 7 };

/** The reverse gear is fixed and permanently meshed with the drum. */
const REVERSE = { x: 170, y: 142.68, r: 12, teeth: 8, depth: 5 };

/**
 * The swing gear rides a yoke pivoting on the hub axis, so it stays meshed with
 * the hub at every yoke angle. The two seat angles were solved from the mesh
 * distances: at YOKE_UP it sits `SWING.r + DRUM.r` from the drum, at
 * YOKE_DOWN it sits `SWING.r + REVERSE.r` from the reverse gear.
 */
const SWING = { r: 13, teeth: 9, depth: 5, arm: 32 };
const YOKE_UP = 23.99; // direct drive: hub → swing → drum
const YOKE_DOWN = -55.94; // reverse engaged: hub → swing → reverse → drum

/**
 * One turn of the needle pays out `hub radius × angle` of cable: the gears
 * between only set direction, so their sizes cancel out of the ratio. That
 * identity is why the travel below is exactly HUB.r × SWEEP_RAD.
 */
const TRAVEL = HUB.r * SWEEP_RAD;

const CAR = { w: 60, h: 56, x: DRUM.x - DRUM.r, top: 212 };
const CAR_BOTTOM = CAR.top + TRAVEL;
const WEIGHT = { w: 20, h: 38, x: DRUM.x + DRUM.r, low: 300 };
const SHAFT = { x: 74, y: 200, w: 118, h: 172 };

/** Where Nookies sits in the car, and how far his waving arm reaches. */
const NOOKIE = { x: CAR.x, y: 30, scale: 0.55 };
const ARM_SHOULDER = { x: -11, y: 4 };
const ARM_REST = { x: -12, y: -9 }; // shoulder → hand, in Nookies' own frame
const ARM_LENGTH = Math.hypot(ARM_REST.x, ARM_REST.y);

/** The lever Nookies throws, in car-local coordinates. */
const LEVER = { x: 102, y: 18, handle: 10, pin: 6, seatUp: -20, seatDown: 20 };

/** Guide pulley the control rope turns over on its way to the gearbox. */
const PULLEY = { x: 79, y: 122, r: 5.5 };

/**
 * The bellcrank on the yoke axle that the rope pulls. Its seat is solved so
 * that at YOKE_UP the rope runs straight at the hub centre, which is where
 * rotating the crank changes the rope length fastest — 31.7 units of throw
 * between the two seats, rather than the 4 a badly placed crank would give.
 */
const CRANK_R = 30;
const CRANK_BASE = ((): { x: number; y: number } => {
  const dx = PULLEY.x - HUB.x;
  const dy = PULLEY.y - HUB.y;
  const len = Math.hypot(dx, dy);
  const aimed = { x: (dx / len) * CRANK_R, y: (dy / len) * CRANK_R };
  const a = (YOKE_UP * Math.PI) / 180;
  // Undo the yoke rotation to express the pin in the yoke's own frame.
  return {
    x: aimed.x * Math.cos(a) + aimed.y * Math.sin(a),
    y: -aimed.x * Math.sin(a) + aimed.y * Math.cos(a),
  };
})();

/** How long a full shift takes, and when each stage of it runs. */
const SHIFT_MS = 1150;
const STAGE = {
  reach: [0.0, 0.18],
  lever: [0.16, 0.44],
  rope: [0.28, 0.66],
  yoke: [0.5, 0.84],
  release: [0.8, 1.0],
} as const;

/** Length of the highlight that travels up the rope, in path units. */
const PULSE_LENGTH = 16;

const NEEDLE_LENGTH = 58;
const ARC_LENGTH = 2 * Math.PI * DIAL.radius * (SWEEP / 360);
const RING_LENGTH = 2 * Math.PI * DIAL.ringRadius * (SWEEP / 360);

/** Time constant of the value easing, in ms. Frame-rate independent. */
const EASE_TAU = 110;

const ACCENTS: Record<GaugeAccent, string> = {
  primary: 'var(--md-sys-color-primary)',
  secondary: 'var(--md-sys-color-secondary)',
  tertiary: 'var(--md-sys-color-tertiary)',
};

let instanceCount = 0;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Progress of one stage of the shift, given overall progress. */
function stage(t: number, [from, to]: readonly [number, number]): number {
  return clamp((t - from) / (to - from), 0, 1);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Overshoots slightly, so the lever lands with a mechanical snap. */
function easeOutBack(t: number): number {
  // Kept low deliberately: a bigger overshoot swings the handle into Nookies.
  const c = 1.4;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

function polar(radius: number, degrees: number): [number, number] {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return [DIAL.x + radius * Math.cos(rad), DIAL.y + radius * Math.sin(rad)];
}

function arcPath(radius: number): string {
  const [x1, y1] = polar(radius, START_ANGLE);
  const [x2, y2] = polar(radius, START_ANGLE + SWEEP);
  return (
    `M ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
    `A ${radius} ${radius} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
  );
}

/**
 * The outline of a spur gear centred on the origin: `teeth` trapezoidal teeth
 * straddling the pitch radius.
 */
function gearPath(radius: number, teeth: number, depth: number): string {
  const step = (Math.PI * 2) / teeth;
  const outer = radius + depth / 2;
  const inner = radius - depth / 2;
  const at = (angle: number, r: number): string =>
    `${(Math.cos(angle) * r).toFixed(2)} ${(Math.sin(angle) * r).toFixed(2)}`;

  const parts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    parts.push(`${i === 0 ? 'M' : 'L'} ${at(a + step * 0.1, outer)}`);
    parts.push(`L ${at(a + step * 0.4, outer)}`);
    parts.push(`L ${at(a + step * 0.6, inner)}`);
    parts.push(`L ${at(a + step * 0.9, inner)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/**
 * Nookies, drawn centred on the origin and roughly 52 units tall.
 *
 * The fur stays beige in both themes — a mascot that changes colour with the
 * palette stops being the same character — while the scarf takes the seed
 * colour so it still belongs to the Material You theme.
 */
function nookieMarkup(): string {
  return `
  <g class="nookie">
    <g class="nookie__arm nookie__arm--back"><path d="M11 4 q10 -1 12 -9"/></g>
    <ellipse class="nookie__ear" cx="-12" cy="-20" rx="6.6" ry="6.6"/>
    <ellipse class="nookie__ear" cx="12" cy="-20" rx="6.6" ry="6.6"/>
    <ellipse class="nookie__ear-inner" cx="-12" cy="-20" rx="3" ry="3"/>
    <ellipse class="nookie__ear-inner" cx="12" cy="-20" rx="3" ry="3"/>
    <rect class="nookie__torso" x="-14" y="-2" width="28" height="25" rx="11"/>
    <ellipse class="nookie__belly" cx="0" cy="12" rx="8" ry="8"/>
    <path class="nookie__scarf" d="M-13 -1 q13 7 26 0 v5 q-13 7 -26 0 z"/>
    <path class="nookie__scarf-tail" d="M9 3 q6 4 4 11 l-5 -1 q2 -6 -2 -9 z"/>
    <circle class="nookie__head" cx="0" cy="-10" r="15"/>
    <ellipse class="nookie__muzzle" cx="0" cy="-5" rx="8.2" ry="6.4"/>
    <ellipse class="nookie__nose" cx="0" cy="-8.4" rx="2.7" ry="2"/>
    <path class="nookie__mouth" d="M0 -6.6 v2 M0 -4.6 q-2.6 2.2 -4.6 0 M0 -4.6 q2.6 2.2 4.6 0"/>
    <g class="nookie__eyes">
      <ellipse cx="-6" cy="-13.5" rx="2" ry="2.4"/>
      <ellipse cx="6" cy="-13.5" rx="2" ry="2.4"/>
    </g>
    <ellipse class="nookie__blush" cx="-10" cy="-7" rx="3" ry="2"/>
    <ellipse class="nookie__blush" cx="10" cy="-7" rx="3" ry="2"/>
    <g class="nookie__arm nookie__arm--wave"><path d="M-11 4 q-10 -1 -12 -9"/></g>
  </g>`;
}

function gearMarkup(
  name: string,
  g: { x: number; y: number; r: number; teeth: number; depth: number },
  inner = '',
): string {
  const reach = (g.r - g.depth / 2 - 2.5).toFixed(1);
  return `
  <g class="lift__gear lift__gear--${name}" transform="translate(${g.x} ${g.y})">
    <g class="lift__gear-spin">
      <path class="lift__gear-body" d="${gearPath(g.r, g.teeth, g.depth)}"/>
      <path class="lift__gear-spoke" d="M0 -${reach}V${reach}M-${reach} 0H${reach}"/>
      ${inner}
    </g>
  </g>`;
}

export class LiftScene implements SpeedVisual {
  readonly root: HTMLElement;

  private readonly svg: SVGSVGElement;
  private readonly carGroup: SVGGElement;
  private readonly weightGroup: SVGGElement;
  private readonly carCable: SVGLineElement;
  private readonly weightCable: SVGLineElement;
  private readonly yoke: SVGGElement;
  private readonly lever: SVGGElement;
  private readonly rope: SVGPathElement;
  private readonly ropePulse: SVGPathElement;
  private readonly waveArm: SVGGElement;
  private readonly hubSpin: SVGGElement;
  private readonly swingSpin: SVGGElement;
  private readonly reverseSpin: SVGGElement;
  private readonly drumSpin: SVGGElement;
  private readonly valueArc: SVGPathElement;
  private readonly ringArc: SVGPathElement;
  private readonly numberEl: HTMLElement;
  private readonly unitEl: HTMLElement;
  private readonly phaseEl: HTMLElement;

  /** Eased reading, in Mbps. The dial and the whole gear train follow it. */
  private shown = 0;
  private target = 0;

  /**
   * Progress through a gear shift, 0..1. It runs on its own clock rather than
   * easing toward a value, because the stages have to arrive in order: hand,
   * lever, rope, yoke.
   */
  private shiftT = 1;
  private yokeAngle = YOKE_UP;
  private leverAngle = LEVER.seatUp;
  private shiftFromYoke = YOKE_UP;
  private shiftToYoke = YOKE_UP;
  private shiftFromLever = LEVER.seatUp;
  private shiftToLever = LEVER.seatUp;

  /** Where the car sat when the current direction was selected. */
  private anchor = CAR.top;
  private driveSign = -1; // -1 climbs, +1 descends
  private reading: number | null = null;
  private unit = 'Mbps';

  private frame = 0;
  private lastFrameAt = 0;

  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor() {
    const clipId = `lift-shaft-${++instanceCount}`;

    this.root = document.createElement('figure');
    this.root.className = 'lift';
    this.root.dataset.drive = 'up';
    this.root.dataset.shifting = 'false';

    const stage = document.createElement('div');
    stage.className = 'lift__stage';
    stage.innerHTML = this.markup(clipId);
    this.root.append(stage);

    this.svg = stage.querySelector('svg')!;
    this.carGroup = this.svg.querySelector('.lift__car')!;
    this.weightGroup = this.svg.querySelector('.lift__weight')!;
    this.carCable = this.svg.querySelector('.lift__cable--car')!;
    this.weightCable = this.svg.querySelector('.lift__cable--weight')!;
    this.yoke = this.svg.querySelector('.lift__yoke')!;
    this.lever = this.svg.querySelector('.lift__lever')!;
    this.rope = this.svg.querySelector('.lift__rope')!;
    this.ropePulse = this.svg.querySelector('.lift__rope-pulse')!;
    this.waveArm = this.svg.querySelector('.nookie__arm--wave')!;
    this.hubSpin = this.svg.querySelector('.lift__gear--hub .lift__gear-spin')!;
    this.swingSpin = this.svg.querySelector('.lift__gear--swing .lift__gear-spin')!;
    this.reverseSpin = this.svg.querySelector('.lift__gear--reverse .lift__gear-spin')!;
    this.drumSpin = this.svg.querySelector('.lift__gear--drum .lift__gear-spin')!;
    this.valueArc = this.svg.querySelector('.lift__dial-value')!;
    this.ringArc = this.svg.querySelector('.lift__progress-ring')!;

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

  private markup(clipId: string): string {
    const dialTicks = TICKS.map(([value, label]) => {
      const angle = START_ANGLE + toFraction(value) * SWEEP;
      const [x1, y1] = polar(DIAL.radius - DIAL.width / 2 - 3, angle);
      const [x2, y2] = polar(DIAL.radius - DIAL.width / 2 - 9, angle);
      const [lx, ly] = polar(DIAL.labelRadius, angle);
      return (
        `<line class="lift__dial-tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>` +
        `<text class="lift__dial-label" x="${lx.toFixed(1)}" y="${(ly + 3.2).toFixed(1)}">${label}</text>`
      );
    }).join('');

    // Evenly spaced floors: structure, not a second scale. The numbers live on
    // the dial, which is the only thing that reads the same in both directions.
    const floors = [1, 2, 3, 4, 5]
      .map((k) => {
        const y = (SHAFT.y + (SHAFT.h * k) / 6).toFixed(1);
        return `<line class="lift__floor" x1="${SHAFT.x + 6}" y1="${y}" x2="${SHAFT.x + SHAFT.w - 6}" y2="${y}"/>`;
      })
      .join('');

    const streaks = [86, 100, 128, 176]
      .map(
        (x, i) =>
          `<line class="lift__streak" x1="${x}" y1="-26" x2="${x}" y2="8" style="animation-delay:${(i * 0.19).toFixed(2)}s"/>`,
      )
      .join('');

    return `
<svg viewBox="0 0 280 384" class="lift__svg" role="img"
     aria-label="A speed dial geared to a lift: a reversing gear sends Nookies the bear down the shaft while downloading and back up while uploading">
  <defs>
    <clipPath id="${clipId}">
      <rect x="${SHAFT.x + 2}" y="${SHAFT.y + 2}" width="${SHAFT.w - 4}" height="${SHAFT.h - 4}" rx="10"/>
    </clipPath>
  </defs>

  <!-- dial face -->
  <path class="lift__dial-track" d="${arcPath(DIAL.radius)}" stroke-width="${DIAL.width}"/>
  <path class="lift__dial-value" d="${arcPath(DIAL.radius)}" stroke-width="${DIAL.width}"
        stroke-dasharray="${ARC_LENGTH.toFixed(2)} ${ARC_LENGTH.toFixed(2)}"
        stroke-dashoffset="${ARC_LENGTH.toFixed(2)}"/>
  <path class="lift__progress-ring" d="${arcPath(DIAL.ringRadius)}" stroke-width="2.5"
        stroke-dasharray="${RING_LENGTH.toFixed(2)} ${RING_LENGTH.toFixed(2)}"
        stroke-dashoffset="${RING_LENGTH.toFixed(2)}"/>
  ${dialTicks}

  <!-- shaft -->
  <rect class="lift__shaft-fill" x="${SHAFT.x}" y="${SHAFT.y}" width="${SHAFT.w}" height="${SHAFT.h}" rx="12"/>
  <g clip-path="url(#${clipId})">
    <g class="lift__streaks">${streaks}</g>
    ${floors}
    <path class="lift__rail" d="M82 ${SHAFT.y + 6}V${SHAFT.y + SHAFT.h - 6}M184 ${SHAFT.y + 6}V${SHAFT.y + SHAFT.h - 6}"/>
    <path class="lift__pit" d="M${SHAFT.x} ${SHAFT.y + SHAFT.h - 14}h${SHAFT.w}v14h-${SHAFT.w}z"/>
  </g>
  <rect class="lift__shaft-frame" x="${SHAFT.x}" y="${SHAFT.y}" width="${SHAFT.w}" height="${SHAFT.h}" rx="12"/>

  <!-- drum, then the cable it winds -->
  ${gearMarkup('drum', DRUM, `<circle class="lift__gear-hub" r="6"/><path class="lift__drum-groove" d="M0 -${DRUM.r - 5}A${DRUM.r - 5} ${DRUM.r - 5} 0 0 1 0 ${DRUM.r - 5}"/>`)}
  <path class="lift__cable" d="M${CAR.x} ${DRUM.y} A ${DRUM.r} ${DRUM.r} 0 0 1 ${WEIGHT.x} ${DRUM.y}"/>
  <line class="lift__cable lift__cable--car" x1="${CAR.x}" y1="${DRUM.y}" x2="${CAR.x}" y2="${CAR.top}"/>
  <line class="lift__cable lift__cable--weight" x1="${WEIGHT.x}" y1="${DRUM.y}" x2="${WEIGHT.x}" y2="${WEIGHT.low}"/>

  <!-- counterweight -->
  <g class="lift__weight" transform="translate(0 ${WEIGHT.low})">
    <rect class="lift__weight-body" x="${WEIGHT.x - WEIGHT.w / 2}" y="0" width="${WEIGHT.w}" height="${WEIGHT.h}" rx="3"/>
    <path class="lift__weight-plates" d="M${WEIGHT.x - 6} 10h12M${WEIGHT.x - 6} 19h12M${WEIGHT.x - 6} 28h12"/>
  </g>

  <!-- car -->
  <g class="lift__car" transform="translate(0 ${CAR.top})">
    <path class="lift__hook" d="M${CAR.x} -6v6M${CAR.x - 6} 0h12"/>
    <rect class="lift__car-roof" x="${CAR.x - CAR.w / 2 - 3}" y="0" width="${CAR.w + 6}" height="6" rx="3"/>
    <rect class="lift__car-body" x="${CAR.x - CAR.w / 2}" y="5" width="${CAR.w}" height="${CAR.h - 5}" rx="8"/>
    <rect class="lift__car-window" x="${CAR.x - CAR.w / 2 + 7}" y="11" width="${CAR.w - 14}" height="34" rx="6"/>
    <path class="lift__car-lamp" d="M${CAR.x - 4} 13h8"/>
    <path class="lift__bracket" d="M${CAR.x - CAR.w / 2} 14H${PULLEY.x}"/>
    <circle class="lift__lever-mount" cx="${LEVER.x}" cy="${LEVER.y}" r="2.6"/>
    <g class="lift__lever" transform="rotate(${LEVER.seatUp} ${LEVER.x} ${LEVER.y})">
      <path class="lift__lever-tail" d="M${LEVER.x} ${LEVER.y}V${LEVER.y - LEVER.pin}"/>
      <circle class="lift__lever-pin" cx="${LEVER.x}" cy="${LEVER.y - LEVER.pin}" r="1.8"/>
      <path class="lift__lever-arm" d="M${LEVER.x} ${LEVER.y}V${LEVER.y + LEVER.handle}"/>
      <circle class="lift__lever-knob" cx="${LEVER.x}" cy="${LEVER.y + LEVER.handle}" r="2.7"/>
    </g>
    <g transform="translate(${NOOKIE.x} ${NOOKIE.y}) scale(${NOOKIE.scale})">${nookieMarkup()}</g>
    <path class="lift__car-floor" d="M${CAR.x - CAR.w / 2 + 5} 48h${CAR.w - 10}"/>
  </g>

  <!-- control rope: lever → car outrigger → guide pulley → bellcrank -->
  <path class="lift__rope"/>
  <path class="lift__rope-pulse"/>
  <circle class="lift__pulley" cx="${PULLEY.x}" cy="${PULLEY.y}" r="${PULLEY.r}"/>
  <circle class="lift__pulley-hub" cx="${PULLEY.x}" cy="${PULLEY.y}" r="1.8"/>

  <!-- reversing gear: fixed, always meshed with the drum -->
  ${gearMarkup('reverse', REVERSE, `<circle class="lift__gear-hub" r="3.8"/>`)}

  <!-- the yoke that rocks the swing gear between the drum and the reverse gear -->
  <g class="lift__yoke" transform="rotate(${YOKE_UP} ${HUB.x} ${HUB.y})">
    <path class="lift__yoke-arm" d="M${HUB.x} ${HUB.y}V${HUB.y + SWING.arm}"/>
    <path class="lift__crank-arm" d="M${HUB.x} ${HUB.y}L${(HUB.x + CRANK_BASE.x).toFixed(2)} ${(HUB.y + CRANK_BASE.y).toFixed(2)}"/>
    <circle class="lift__crank-pin" cx="${(HUB.x + CRANK_BASE.x).toFixed(2)}" cy="${(HUB.y + CRANK_BASE.y).toFixed(2)}" r="3.2"/>
    ${gearMarkup('swing', { x: HUB.x, y: HUB.y + SWING.arm, ...SWING }, `<circle class="lift__gear-hub" r="4"/>`)}
  </g>

  <!-- the needle, on the hub gear that drives all of it -->
  ${gearMarkup(
    'hub',
    HUB,
    `<path class="lift__needle" d="M-3.4 0 L0 -${NEEDLE_LENGTH} L3.4 0 Z"/>` +
      `<circle class="lift__needle-cap" r="5"/>`,
  )}
</svg>`;
  }

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

    // Re-anchor on the car's current target. The next phase starts from a
    // reading of zero, so the car does not move when the gear shifts — it just
    // starts travelling the other way.
    this.anchor = this.carTopFor(toFraction(this.target));
    this.driveSign = sign;
    this.root.dataset.drive = direction;

    const yokeSeat = direction === 'down' ? YOKE_DOWN : YOKE_UP;
    const leverSeat = direction === 'down' ? LEVER.seatDown : LEVER.seatUp;

    if (this.reducedMotion.matches) {
      this.seat(yokeSeat, leverSeat);
      this.paint();
      return;
    }
    // Interrupting a shift picks up from wherever the linkage currently is.
    this.shiftFromYoke = this.yokeAngle;
    this.shiftFromLever = this.leverAngle;
    this.shiftToYoke = yokeSeat;
    this.shiftToLever = leverSeat;
    this.shiftT = 0;
    this.root.dataset.shifting = 'true';
    this.startLoop();
  }

  /** Puts the linkage straight into a seat, with no choreography. */
  private seat(yokeSeat: number, leverSeat: number): void {
    this.shiftT = 1;
    this.yokeAngle = yokeSeat;
    this.leverAngle = leverSeat;
    this.shiftFromYoke = this.shiftToYoke = yokeSeat;
    this.shiftFromLever = this.shiftToLever = leverSeat;
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
    this.ringArc.setAttribute(
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

  /**
   * Marks a test as running. The gear train is not affected — it only ever
   * turns because the needle turned — but the ambient details (Nookies' wave,
   * the streaks in the shaft) are.
   */
  setActive(active: boolean): void {
    this.root.dataset.active = String(active);
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Car position for a reading, measured from the anchor in the drive direction. */
  private carTopFor(fraction: number): number {
    return clamp(this.anchor + this.driveSign * fraction * TRAVEL, CAR.top, CAR_BOTTOM);
  }

  private startLoop(): void {
    if (this.frame) return;
    this.lastFrameAt = 0;
    const step = (now: number): void => {
      const dt = this.lastFrameAt ? Math.min(64, now - this.lastFrameAt) : 16;
      this.lastFrameAt = now;

      // Exponential approach expressed against elapsed time, so the motion is
      // identical on a 60 Hz and a 144 Hz display.
      const valueDelta = this.target - this.shown;
      this.shown += valueDelta * (1 - Math.exp(-dt / EASE_TAU));

      // The shift runs to a fixed schedule so its stages keep their order.
      if (this.shiftT < 1) {
        this.shiftT = Math.min(1, this.shiftT + dt / SHIFT_MS);
        if (this.shiftT === 1) this.root.dataset.shifting = 'false';
      }

      const settled = Math.abs(valueDelta) < 0.005 && this.shiftT === 1;
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

  /** Absolute position of the bellcrank pin for a yoke angle. */
  private crankPin(yokeDeg: number): { x: number; y: number } {
    const a = (yokeDeg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return {
      x: HUB.x + CRANK_BASE.x * c - CRANK_BASE.y * s,
      y: HUB.y + CRANK_BASE.x * s + CRANK_BASE.y * c,
    };
  }

  /** The control rope, drawn end to end from the lever to the bellcrank. */
  private ropeShape(carTop: number, leverDeg: number, yokeDeg: number): string {
    const a = (leverDeg * Math.PI) / 180;
    // The rope is taken up by the short end of the lever, opposite the handle.
    const pinX = LEVER.x + LEVER.pin * Math.sin(a);
    const pinY = carTop + LEVER.y - LEVER.pin * Math.cos(a);
    const crank = this.crankPin(yokeDeg);
    return (
      `M ${pinX.toFixed(2)} ${pinY.toFixed(2)}` +
      ` L 89 ${(carTop + 9).toFixed(2)}` +
      ` L ${CAR.x - CAR.w / 2} ${(carTop + 14).toFixed(2)}` +
      ` L ${PULLEY.x} ${(carTop + 14).toFixed(2)}` +
      ` L ${PULLEY.x} ${PULLEY.y}` +
      ` L ${crank.x.toFixed(2)} ${crank.y.toFixed(2)}`
    );
  }

  /**
   * Points Nookies' waving arm at the lever handle while he has hold of it.
   * The arm stretches a little to close the gap, which is the oldest trick in
   * character animation and completely invisible at this size.
   */
  private armShape(leverDeg: number, grip: number): string {
    const a = (leverDeg * Math.PI) / 180;
    const tipX = LEVER.x - LEVER.handle * Math.sin(a);
    const tipY = LEVER.y + LEVER.handle * Math.cos(a);
    const toHandle = {
      x: (tipX - NOOKIE.x) / NOOKIE.scale - ARM_SHOULDER.x,
      y: (tipY - NOOKIE.y) / NOOKIE.scale - ARM_SHOULDER.y,
    };
    const cross = ARM_REST.x * toHandle.y - ARM_REST.y * toHandle.x;
    const dot = ARM_REST.x * toHandle.x + ARM_REST.y * toHandle.y;
    const deg = (Math.atan2(cross, dot) * 180) / Math.PI;
    const stretch = clamp(Math.hypot(toHandle.x, toHandle.y) / ARM_LENGTH, 1, 1.35);
    return `rotate(${(deg * grip).toFixed(2)}) scale(${lerp(1, stretch, grip).toFixed(3)})`;
  }

  private paint(): void {
    const fraction = toFraction(this.shown);

    // --- the shift: hand, then lever, then rope, then yoke ---
    const shift = this.shiftT;
    this.leverAngle = lerp(
      this.shiftFromLever,
      this.shiftToLever,
      easeOutBack(stage(shift, STAGE.lever)),
    );
    this.yokeAngle = lerp(
      this.shiftFromYoke,
      this.shiftToYoke,
      easeInOut(stage(shift, STAGE.yoke)),
    );
    const grip =
      easeInOut(stage(shift, STAGE.reach)) * (1 - easeInOut(stage(shift, STAGE.release)));

    this.lever.setAttribute(
      'transform',
      `rotate(${this.leverAngle.toFixed(2)} ${LEVER.x} ${LEVER.y})`,
    );
    this.waveArm.style.transform = grip > 0.002 ? this.armShape(this.leverAngle, grip) : '';

    // The needle angle is the single input. Every gear ratio below is exact,
    // and the cable payout that positions the car is the same number again.
    const needleDeg = fraction * SWEEP;
    const swingDeg = -needleDeg * (HUB.r / SWING.r);
    // Descending pays cable out, which is the drum turning anticlockwise.
    const drumDeg = -this.driveSign * needleDeg * (HUB.r / DRUM.r);
    const reverseDeg = -drumDeg * (DRUM.r / REVERSE.r);

    this.hubSpin.setAttribute('transform', `rotate(${(START_ANGLE + needleDeg).toFixed(2)})`);
    this.swingSpin.setAttribute('transform', `rotate(${swingDeg.toFixed(2)})`);
    this.drumSpin.setAttribute('transform', `rotate(${drumDeg.toFixed(2)})`);
    this.reverseSpin.setAttribute('transform', `rotate(${reverseDeg.toFixed(2)})`);
    this.yoke.setAttribute(
      'transform',
      `rotate(${this.yokeAngle.toFixed(2)} ${HUB.x} ${HUB.y})`,
    );

    const carTop = this.carTopFor(fraction);
    // The counterweight is on the other strand, so it mirrors the car exactly.
    const weightTop = WEIGHT.low - (carTop - CAR.top);
    this.carGroup.setAttribute('transform', `translate(0 ${carTop.toFixed(2)})`);
    this.weightGroup.setAttribute('transform', `translate(0 ${weightTop.toFixed(2)})`);
    this.carCable.setAttribute('y2', carTop.toFixed(2));
    this.weightCable.setAttribute('y2', weightTop.toFixed(2));

    this.valueArc.setAttribute('stroke-dashoffset', String(ARC_LENGTH * (1 - fraction)));

    // The rope is redrawn from the two moving ends, so it stays connected
    // wherever the car and the yoke happen to be.
    const ropeD = this.ropeShape(carTop, this.leverAngle, this.yokeAngle);
    this.rope.setAttribute('d', ropeD);

    const pull = stage(shift, STAGE.rope);
    if (pull > 0 && pull < 1) {
      // A single dash sent along the rope: the pull travelling to the gearbox.
      const total = this.rope.getTotalLength();
      this.ropePulse.setAttribute('d', ropeD);
      this.ropePulse.setAttribute('stroke-dasharray', `${PULSE_LENGTH} ${total.toFixed(1)}`);
      this.ropePulse.setAttribute(
        'stroke-dashoffset',
        (PULSE_LENGTH - easeInOut(pull) * (total + PULSE_LENGTH)).toFixed(1),
      );
      this.ropePulse.style.opacity = Math.sin(Math.PI * pull).toFixed(3);
    } else {
      this.ropePulse.style.opacity = '0';
    }

    this.root.style.setProperty('--lift-effort', fraction.toFixed(3));
    this.root.style.setProperty('--nookie-bob', `${(2.6 - fraction * 1.8).toFixed(2)}s`);
    this.root.style.setProperty('--streak-duration', `${(1.5 - fraction * 1.15).toFixed(2)}s`);

    this.numberEl.textContent = readoutText(this.reading ?? this.shown, this.unit);
  }
}
