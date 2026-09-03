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

const NEEDLE_LENGTH = 58;
const ARC_LENGTH = 2 * Math.PI * DIAL.radius * (SWEEP / 360);
const RING_LENGTH = 2 * Math.PI * DIAL.ringRadius * (SWEEP / 360);

/** Time constants of the easing, in ms. Frame-rate independent. */
const EASE_TAU = 110;
const YOKE_TAU = 90;

const ACCENTS: Record<GaugeAccent, string> = {
  primary: 'var(--md-sys-color-primary)',
  secondary: 'var(--md-sys-color-secondary)',
  tertiary: 'var(--md-sys-color-tertiary)',
};

let instanceCount = 0;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
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
  private readonly hubSpin: SVGGElement;
  private readonly swingSpin: SVGGElement;
  private readonly reverseSpin: SVGGElement;
  private readonly drumSpin: SVGGElement;
  private readonly valueArc: SVGPathElement;
  private readonly ringArc: SVGPathElement;
  private readonly numberEl: HTMLElement;
  private readonly unitEl: HTMLElement;
  private readonly phaseEl: HTMLElement;

  /** Eased state. Everything drawn is derived from these three numbers. */
  private shown = 0;
  private yokeAngle = YOKE_UP;

  private target = 0;
  private yokeTarget = YOKE_UP;

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
    <g transform="translate(${CAR.x} 30) scale(0.55)">${nookieMarkup()}</g>
    <path class="lift__car-floor" d="M${CAR.x - CAR.w / 2 + 5} 48h${CAR.w - 10}"/>
  </g>

  <!-- reversing gear: fixed, always meshed with the drum -->
  ${gearMarkup('reverse', REVERSE, `<circle class="lift__gear-hub" r="3.8"/>`)}

  <!-- the yoke that rocks the swing gear between the drum and the reverse gear -->
  <g class="lift__yoke" transform="rotate(${YOKE_UP} ${HUB.x} ${HUB.y})">
    <path class="lift__yoke-arm" d="M${HUB.x} ${HUB.y}V${HUB.y + SWING.arm}"/>
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
      this.yokeAngle = this.yokeTarget;
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
    this.yokeTarget = direction === 'down' ? YOKE_DOWN : YOKE_UP;
    this.root.dataset.drive = direction;

    if (this.reducedMotion.matches) {
      this.yokeAngle = this.yokeTarget;
      this.paint();
      return;
    }
    this.startLoop();
  }

  reset(): void {
    this.target = 0;
    this.shown = 0;
    this.reading = null;
    this.anchor = CAR.top;
    this.driveSign = -1;
    this.yokeTarget = YOKE_UP;
    this.root.dataset.drive = 'up';
    this.setProgress(0);
    if (this.reducedMotion.matches) this.yokeAngle = YOKE_UP;
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

      const yokeDelta = this.yokeTarget - this.yokeAngle;
      this.yokeAngle += yokeDelta * (1 - Math.exp(-dt / YOKE_TAU));

      const settled = Math.abs(valueDelta) < 0.005 && Math.abs(yokeDelta) < 0.05;
      if (settled) {
        this.shown = this.target;
        this.yokeAngle = this.yokeTarget;
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
    const fraction = toFraction(this.shown);

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

    this.root.style.setProperty('--lift-effort', fraction.toFixed(3));
    this.root.style.setProperty('--nookie-bob', `${(2.6 - fraction * 1.8).toFixed(2)}s`);
    this.root.style.setProperty('--streak-duration', `${(1.5 - fraction * 1.15).toFixed(2)}s`);

    this.numberEl.textContent = readoutText(this.reading ?? this.shown, this.unit);
  }
}
