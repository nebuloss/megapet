import { icon, type IconName } from '../primitives/icons';
import { TICKS, toFraction } from './scale';
import { readoutText, type Drive, type GaugeAccent, type SpeedVisual } from './visual';

const CENTER = 100;
const ARC_RADIUS = 74;
const ARC_WIDTH = 15;
const RING_RADIUS = 88;
const LABEL_RADIUS = 99;
const START_ANGLE = 225;
const SWEEP = 270;

const ARC_LENGTH = 2 * Math.PI * ARC_RADIUS * (SWEEP / 360);
const RING_LENGTH = 2 * Math.PI * RING_RADIUS * (SWEEP / 360);

const ACCENTS: Record<GaugeAccent, string> = {
  primary: 'var(--md-sys-color-primary)',
  secondary: 'var(--md-sys-color-secondary)',
  tertiary: 'var(--md-sys-color-tertiary)',
};

function polar(radius: number, degrees: number): [number, number] {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

function arcPath(radius: number, sweep: number): string {
  // A full circle cannot be one A command; the dial never reaches 360 degrees,
  // but clamp anyway so a rounding error cannot collapse the arc to nothing.
  const capped = Math.min(359.9, sweep);
  const [x1, y1] = polar(radius, START_ANGLE);
  const [x2, y2] = polar(radius, START_ANGLE + capped);
  const large = capped > 180 ? 1 : 0;
  return (
    `M ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
    `A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
  );
}

/** The plain circular dial: the alternative to the lift scene. */
export class DialVisual implements SpeedVisual {
  readonly root: HTMLElement;

  /** Nothing to watch here, so the dial only pauses long enough to settle. */
  readonly transitionMs = 400;

  private readonly valueArc: SVGPathElement;
  private readonly ringArc: SVGPathElement;
  private readonly numberEl: HTMLElement;
  private readonly unitEl: HTMLElement;
  private readonly phaseEl: HTMLElement;

  private shown = 0;
  /** Needle position, 0..1. Eased here rather than in Mbps — see `toFraction`. */
  private shownFraction = 0;
  /** Where the arc is heading, 0..1. Converted when the target is set, so the
   *  frame loop stays free of transcendental maths. */
  private aimFraction = 0;
  private target = 0;
  private frame = 0;
  private unit = 'Mbps';
  private reading: number | null = null;

  constructor() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '-10 -10 220 220');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Speed dial');

    const arc = (className: string, radius: number, width: string, length: number): SVGPathElement => {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('class', className);
      path.setAttribute('d', arcPath(radius, SWEEP));
      path.setAttribute('stroke-width', width);
      path.setAttribute('stroke-dasharray', `${length} ${length}`);
      path.setAttribute('stroke-dashoffset', String(length));
      return path;
    };

    const track = document.createElementNS(ns, 'path');
    track.setAttribute('class', 'gauge__track');
    track.setAttribute('d', arcPath(ARC_RADIUS, SWEEP));
    track.setAttribute('stroke-width', String(ARC_WIDTH));

    this.ringArc = arc('gauge__progress-arc', RING_RADIUS, '3.5', RING_LENGTH);
    this.valueArc = arc('gauge__value-arc', ARC_RADIUS, String(ARC_WIDTH), ARC_LENGTH);
    svg.append(track, this.ringArc, this.valueArc);

    for (const [value, label] of TICKS) {
      const [x, y] = polar(LABEL_RADIUS, START_ANGLE + toFraction(value) * SWEEP);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('class', 'gauge__tick-label');
      text.setAttribute('x', x.toFixed(1));
      text.setAttribute('y', (y + 3.5).toFixed(1));
      text.textContent = label;
      svg.append(text);
    }

    this.numberEl = document.createElement('div');
    this.numberEl.className = 'gauge__number tnum';
    this.numberEl.textContent = '0.00';

    this.unitEl = document.createElement('div');
    this.unitEl.className = 'gauge__unit';
    this.unitEl.textContent = this.unit;

    this.phaseEl = document.createElement('div');
    this.phaseEl.className = 'gauge__phase';
    this.phaseEl.dataset.visible = 'false';

    const readout = document.createElement('div');
    readout.className = 'gauge__readout';
    readout.append(this.numberEl, this.unitEl, this.phaseEl);

    this.root = document.createElement('figure');
    this.root.className = 'gauge';
    this.root.append(svg, readout);
  }

  /** Nothing travels on a plain dial, so there is nothing to bring to a stop. */
  land(): void {}

  /**
   * Nothing worth waiting for: a frame here is one arc attribute and one text
   * node, which will not show up in a ping.
   */
  settleMs(): number {
    return 0;
  }

  /** No car to call up, so the latency phase is not held open for one. */
  open(): number {
    return 0;
  }

  /** Nothing travels, so there is nothing to bring home. */
  park(): void {}

  setPosition(mbps: number): void {
    this.aim(Number.isFinite(mbps) && mbps > 0 ? mbps : 0);
    this.startAnimation();
  }

  setReading(value: number | null, unit: string): void {
    this.reading = value;
    if (unit !== this.unit) {
      this.unit = unit;
      this.unitEl.textContent = unit;
    }
    this.paint();
  }

  /** The dial has no direction of travel; the flag is exposed for CSS only. */
  setDrive(direction: Drive): void {
    this.root.dataset.drive = direction;
  }

  reset(): void {
    this.aim(0);
    this.shown = 0;
    this.shownFraction = 0;
    this.reading = null;
    this.setProgress(0);
    this.paint();
  }

  setProgress(fraction: number): void {
    const clamped = Math.min(1, Math.max(0, fraction));
    this.ringArc.setAttribute('stroke-dashoffset', String(RING_LENGTH * (1 - clamped)));
  }

  setAccent(accent: GaugeAccent): void {
    this.root.style.setProperty('--gauge-accent', ACCENTS[accent]);
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

  /** The dial has no continuous motion of its own; the flag is exposed for CSS. */
  setActive(active: boolean): void {
    this.root.dataset.active = String(active);
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Sets the target and its scale position together; they must never drift. */
  private aim(mbps: number): void {
    this.target = mbps;
    this.aimFraction = toFraction(mbps);
  }

  private startAnimation(): void {
    if (this.frame) return;
    const step = (): void => {
      // Exponential ease: quick to catch a big jump, calm near the target.
      // The arc follows the eased fraction, not the eased Mbps: the scale is
      // logarithmic, so easing the value would sweep the arc in one frame.
      const aim = this.aimFraction;
      const delta = aim - this.shownFraction;
      if (Math.abs(delta) < 0.001) {
        this.shown = this.target;
        this.shownFraction = aim;
        this.paint();
        this.frame = 0;
        return;
      }
      // Chasing a live reading wants to be quick; falling back to the stop
      // between phases wants to look like a needle, not a reset.
      const rate = aim === 0 ? 0.045 : 0.22;
      this.shown += (this.target - this.shown) * rate;
      this.shownFraction += delta * rate;
      this.paint();
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private paint(): void {
    this.numberEl.textContent = readoutText(this.reading ?? this.shown, this.unit);
    this.valueArc.setAttribute(
      'stroke-dashoffset',
      String(ARC_LENGTH * (1 - this.shownFraction)),
    );
  }
}
