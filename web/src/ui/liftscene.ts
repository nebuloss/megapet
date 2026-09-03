import { icon, type IconName } from './icons';
import { TICKS, toFraction } from './scale';
import { readoutText, type GaugeAccent, type SpeedVisual } from './visual';

/*
 * The speed dial and the lift are one machine.
 *
 * The needle sits on the hub gear. That gear meshes with an idler, the idler
 * meshes with the drum, and the drum winds the cable that carries the car. So
 * the car's height is not an animation played alongside the reading — it is
 * derived from the needle angle through the gear train, and the floor marks in
 * the shaft line up with the decades on the dial. Move the needle and the lift
 * has to follow.
 */

const DIAL = { x: 140, y: 100, radius: 68, width: 10, ringRadius: 77, labelRadius: 88 };
const START_ANGLE = 225;
const SWEEP = 270;
const SWEEP_RAD = (SWEEP * Math.PI) / 180;

/** Hub (needle), idler, drum. Each pair is mounted at the sum of its radii. */
const HUB = { x: DIAL.x, y: DIAL.y, r: 19, teeth: 13, depth: 6 };
const IDLER = { x: DIAL.x, y: DIAL.y + 30, r: 11, teeth: 8, depth: 5 };
const DRUM = { x: DIAL.x, y: DIAL.y + 67, r: 26, teeth: 15, depth: 7 };

/**
 * One turn of the needle pays out `hub radius × angle` of cable: the idler only
 * reverses direction, so it cancels out of the ratio entirely. That identity is
 * why the travel below is exactly HUB.r × SWEEP_RAD.
 */
const TRAVEL = HUB.r * SWEEP_RAD;

const CAR = { w: 60, h: 56, x: DRUM.x - DRUM.r, topLow: 302 };
const WEIGHT = { w: 20, h: 38, x: DRUM.x + DRUM.r, topHigh: 208 };
const SHAFT = { x: 74, y: 196, w: 118, h: 178 };

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
  inner: string,
): string {
  const spokeReach = (g.r - g.depth / 2 - 3).toFixed(1);
  return `
  <g class="lift__gear lift__gear--${name}" transform="translate(${g.x} ${g.y})">
    <g class="lift__gear-spin">
      <path class="lift__gear-body" d="${gearPath(g.r, g.teeth, g.depth)}"/>
      <path class="lift__gear-spoke" d="M0 -${spokeReach}V${spokeReach}M-${spokeReach} 0H${spokeReach}"/>
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
  private readonly hubSpin: SVGGElement;
  private readonly idlerSpin: SVGGElement;
  private readonly drumSpin: SVGGElement;
  private readonly valueArc: SVGPathElement;
  private readonly ringArc: SVGPathElement;
  private readonly numberEl: HTMLElement;
  private readonly unitEl: HTMLElement;
  private readonly phaseEl: HTMLElement;

  private shown = 0;
  private target = 0;
  private reading: number | null = null;
  private frame = 0;
  private lastFrameAt = 0;
  private unit = 'Mbps';

  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor() {
    const clipId = `lift-shaft-${++instanceCount}`;

    this.root = document.createElement('figure');
    this.root.className = 'lift';

    const stage = document.createElement('div');
    stage.className = 'lift__stage';
    stage.innerHTML = this.markup(clipId);
    this.root.append(stage);

    this.svg = stage.querySelector('svg')!;
    this.carGroup = this.svg.querySelector('.lift__car')!;
    this.weightGroup = this.svg.querySelector('.lift__weight')!;
    this.carCable = this.svg.querySelector('.lift__cable--car')!;
    this.weightCable = this.svg.querySelector('.lift__cable--weight')!;
    this.hubSpin = this.svg.querySelector('.lift__gear--hub .lift__gear-spin')!;
    this.idlerSpin = this.svg.querySelector('.lift__gear--idler .lift__gear-spin')!;
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
    // Dial labels and shaft floor marks are placed from the same fraction, so a
    // needle pointing at 100 puts the car exactly on the 100 floor.
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

    const floors = TICKS.map(([value, label]) => {
      const y = this.carTopFor(toFraction(value)) + CAR.h / 2;
      return (
        `<line class="lift__floor" x1="${SHAFT.x + SHAFT.w + 4}" y1="${y.toFixed(1)}" x2="${SHAFT.x + SHAFT.w + 12}" y2="${y.toFixed(1)}"/>` +
        `<text class="lift__floor-label" x="${SHAFT.x + SHAFT.w + 16}" y="${(y + 3.2).toFixed(1)}">${label}</text>`
      );
    }).join('');

    const streaks = [86, 100, 128, 176]
      .map(
        (x, i) =>
          `<line class="lift__streak" x1="${x}" y1="-26" x2="${x}" y2="8" style="animation-delay:${(i * 0.19).toFixed(2)}s"/>`,
      )
      .join('');

    return `
<svg viewBox="0 0 280 390" class="lift__svg" role="img"
     aria-label="A speed dial geared to a lift: the needle drives the gear train that winds Nookies the bear up the shaft">
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
    <path class="lift__rail" d="M82 ${SHAFT.y + 6}V${SHAFT.y + SHAFT.h - 6}M184 ${SHAFT.y + 6}V${SHAFT.y + SHAFT.h - 6}"/>
    <path class="lift__pit" d="M${SHAFT.x} ${SHAFT.y + SHAFT.h - 14}h${SHAFT.w}v14h-${SHAFT.w}z"/>
  </g>
  <rect class="lift__shaft-frame" x="${SHAFT.x}" y="${SHAFT.y}" width="${SHAFT.w}" height="${SHAFT.h}" rx="12"/>
  ${floors}

  <!-- drum, then the cable it winds -->
  ${gearMarkup('drum', DRUM, `<circle class="lift__gear-hub" r="6"/><path class="lift__drum-groove" d="M0 -${DRUM.r - 5}A${DRUM.r - 5} ${DRUM.r - 5} 0 0 1 0 ${DRUM.r - 5}"/>`)}
  <path class="lift__cable" d="M${CAR.x} ${DRUM.y} A ${DRUM.r} ${DRUM.r} 0 0 1 ${WEIGHT.x} ${DRUM.y}"/>
  <line class="lift__cable lift__cable--car" x1="${CAR.x}" y1="${DRUM.y}" x2="${CAR.x}" y2="${CAR.topLow}"/>
  <line class="lift__cable lift__cable--weight" x1="${WEIGHT.x}" y1="${DRUM.y}" x2="${WEIGHT.x}" y2="${WEIGHT.topHigh}"/>

  <!-- counterweight -->
  <g class="lift__weight" transform="translate(0 ${WEIGHT.topHigh})">
    <rect class="lift__weight-body" x="${WEIGHT.x - WEIGHT.w / 2}" y="0" width="${WEIGHT.w}" height="${WEIGHT.h}" rx="3"/>
    <path class="lift__weight-plates" d="M${WEIGHT.x - 6} 10h12M${WEIGHT.x - 6} 19h12M${WEIGHT.x - 6} 28h12"/>
  </g>

  <!-- car -->
  <g class="lift__car" transform="translate(0 ${CAR.topLow})">
    <path class="lift__hook" d="M${CAR.x} -6v6M${CAR.x - 6} 0h12"/>
    <rect class="lift__car-roof" x="${CAR.x - CAR.w / 2 - 3}" y="0" width="${CAR.w + 6}" height="6" rx="3"/>
    <rect class="lift__car-body" x="${CAR.x - CAR.w / 2}" y="5" width="${CAR.w}" height="${CAR.h - 5}" rx="8"/>
    <rect class="lift__car-window" x="${CAR.x - CAR.w / 2 + 7}" y="11" width="${CAR.w - 14}" height="34" rx="6"/>
    <path class="lift__car-lamp" d="M${CAR.x - 4} 13h8"/>
    <g transform="translate(${CAR.x} 30) scale(0.55)">${nookieMarkup()}</g>
    <path class="lift__car-floor" d="M${CAR.x - CAR.w / 2 + 5} 48h${CAR.w - 10}"/>
  </g>

  <!-- idler, then the needle on the hub gear -->
  ${gearMarkup('idler', IDLER, `<circle class="lift__gear-hub" r="3.6"/>`)}
  ${gearMarkup(
    'hub',
    HUB,
    `<path class="lift__needle" d="M-3.4 0 L0 -${NEEDLE_LENGTH} L3.4 0 Z"/>` +
      `<circle class="lift__needle-cap" r="5"/>`,
  )}
</svg>`;
  }

  private carTopFor(fraction: number): number {
    return CAR.topLow - fraction * TRAVEL;
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

  snap(): void {
    this.shown = this.target;
    this.paint();
  }

  setProgress(fraction: number): void {
    const clamped = Math.min(1, Math.max(0, fraction));
    this.ringArc.setAttribute('stroke-dashoffset', String(RING_LENGTH * (1 - clamped)));
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

  private startLoop(): void {
    if (this.frame) return;
    this.lastFrameAt = 0;
    const step = (now: number): void => {
      const dt = this.lastFrameAt ? Math.min(64, now - this.lastFrameAt) : 16;
      this.lastFrameAt = now;

      // Exponential approach expressed against elapsed time, so the motion is
      // identical on a 60 Hz and a 144 Hz display.
      const delta = this.target - this.shown;
      this.shown += delta * (1 - Math.exp(-dt / EASE_TAU));

      const settled = Math.abs(delta) < 0.005;
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

  private paint(): void {
    const fraction = toFraction(this.shown);

    // Everything below is derived from this one angle. The needle, the three
    // gears, the cable length and the car all move together or not at all.
    const needleDeg = fraction * SWEEP;
    const idlerDeg = -needleDeg * (HUB.r / IDLER.r);
    const drumDeg = needleDeg * (HUB.r / DRUM.r);

    this.hubSpin.setAttribute('transform', `rotate(${(START_ANGLE + needleDeg).toFixed(2)})`);
    this.idlerSpin.setAttribute('transform', `rotate(${idlerDeg.toFixed(2)})`);
    this.drumSpin.setAttribute('transform', `rotate(${drumDeg.toFixed(2)})`);

    const carTop = this.carTopFor(fraction);
    const weightTop = WEIGHT.topHigh + fraction * TRAVEL;
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
