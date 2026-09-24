/**
 * Nookies on a treadmill: the monitor's mascot.
 *
 * The lift is a machine about a *journey* — called up the shaft, down for the
 * download, up for the upload, home at the end — and none of that means
 * anything to a test that never finishes. So he gets an activity with the same
 * shape as the test he is in: a run with no destination, that goes on until
 * you stop it and whose pace is the reading.
 *
 * He is the same bear, drawn by the same `nookieMarkup`, because he is the
 * mascot rather than a decoration on one screen.
 *
 * Only the pace is animated. The belt is drawn as a repeating tread whose
 * phase advances every frame, which is what makes a loop look like travel;
 * the rollers turn at the rate the belt passes over them, so nothing on screen
 * is moving at a speed the others disagree with.
 */
import { TAU } from '../../mech';
import { nookieMarkup } from './lift/nookie';
import { toFraction } from './scale';

/** Roller radius, in the scene's units. The belt wraps both. */
export const ROLLER_R = 13;

/** Centres of the two rollers. */
export const ROLLERS = { left: { x: -34, y: 30 }, right: { x: 34, y: 30 } };

/** Spacing of the tread marks along the belt. */
export const TREAD_GAP = 11;

/**
 * Belt travel at full scale, in scene units per second.
 *
 * Chosen against the tread spacing rather than picked: much faster and the
 * marks alias into a blur that reads as noise, much slower and a gigabit link
 * ambles. This is about six treads a second at the top of the dial.
 */
export const MAX_BELT_SPEED = 62;

/** The slowest the belt creeps while a session is running but the link is idle. */
export const MIN_BELT_SPEED = 3;

/**
 * How fast the belt should run for a reading.
 *
 * Driven by the **fraction** on the shared log scale, never by the Mbps: the
 * scale is logarithmic, so a belt geared to the raw figure would sit still
 * across the whole useful range and then snap to a blur near the top.
 */
export function beltSpeedFor(mbps: number, running: boolean): number {
  if (!running) return 0;
  return MIN_BELT_SPEED + toFraction(mbps) * (MAX_BELT_SPEED - MIN_BELT_SPEED);
}

/** How far the belt moves in `dtMs`, given a reading. */
export function beltStep(mbps: number, running: boolean, dtMs: number): number {
  return (beltSpeedFor(mbps, running) * dtMs) / 1000;
}

/**
 * Roller rotation for a belt phase.
 *
 * The belt does not slip, so the roller turns by the arc it has given up:
 * distance over radius. Deriving it means the two can never drift out of step,
 * which is the thing that makes a drawn mechanism look wrong without the
 * viewer being able to say why.
 */
export function rollerAngle(phase: number): number {
  return ((phase / ROLLER_R) % TAU) * (180 / Math.PI);
}

/** Tread offsets along the belt for a phase, wrapped into one gap. */
export function treadOffsets(phase: number, span: number): number[] {
  const start = -(((phase % TREAD_GAP) + TREAD_GAP) % TREAD_GAP);
  const offsets: number[] = [];
  for (let x = start; x <= span; x += TREAD_GAP) offsets.push(x);
  return offsets;
}

/** How much Nookies bobs as he runs, and how fast, for a reading. */
export function bobPeriodMs(mbps: number, running: boolean): number {
  const speed = beltSpeedFor(mbps, running);
  if (speed <= 0) return 0;
  // One bob per tread passing underneath: his feet and the belt agree.
  return Math.max(90, Math.round((TREAD_GAP / speed) * 1000));
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The treadmill and its bear, as an SVG fragment. */
export function jogMarkup(): string {
  const { left, right } = ROLLERS;
  const top = left.y - ROLLER_R;
  const bottom = left.y + ROLLER_R;
  return `
  <g class="jog">
    <g class="jog__belt">
      <path class="jog__belt-band" d="M${left.x} ${top} H${right.x}
        A${ROLLER_R} ${ROLLER_R} 0 0 1 ${right.x} ${bottom}
        H${left.x} A${ROLLER_R} ${ROLLER_R} 0 0 1 ${left.x} ${top} Z"/>
      <g class="jog__treads"></g>
    </g>
    <g class="jog__roller jog__roller--left" transform="translate(${left.x} ${left.y})">
      <circle class="jog__roller-body" r="${ROLLER_R - 2.5}"/>
      <path class="jog__roller-spoke" d="M0 ${-(ROLLER_R - 2.5)} V${ROLLER_R - 2.5}"/>
    </g>
    <g class="jog__roller jog__roller--right" transform="translate(${right.x} ${right.y})">
      <circle class="jog__roller-body" r="${ROLLER_R - 2.5}"/>
      <path class="jog__roller-spoke" d="M0 ${-(ROLLER_R - 2.5)} V${ROLLER_R - 2.5}"/>
    </g>
    <g class="jog__rider" transform="translate(0 ${top - 28}) scale(0.82)">
      ${nookieMarkup()}
    </g>
  </g>`;
}

/**
 * Drives the treadmill from a live reading.
 *
 * Owns a frame loop only while it is running, so a monitor sitting idle costs
 * nothing; `setRate` is the whole input.
 */
export class Treadmill {
  private readonly treads: SVGGElement;
  private readonly rollers: SVGGElement[];
  private readonly rider: SVGGElement;
  private phase = 0;
  private mbps = 0;
  private active = false;
  private frame: number | null = null;
  private lastFrame = 0;

  constructor(private readonly root: SVGGElement) {
    this.treads = root.querySelector('.jog__treads') as SVGGElement;
    this.rollers = [...root.querySelectorAll<SVGGElement>('.jog__roller')];
    this.rider = root.querySelector('.jog__rider') as SVGGElement;
    // Stamped rather than left absent: the stylesheet selects on these, and an
    // element with no state at all is styled as though it were running.
    this.root.dataset.running = 'false';
    this.setRate(0);
    this.paint();
  }

  /** The live throughput the belt should run at. */
  setRate(mbps: number): void {
    this.mbps = Number.isFinite(mbps) ? Math.max(0, mbps) : 0;
    this.root.dataset.pace = this.active ? paceClass(this.mbps) : 'idle';
    const period = bobPeriodMs(this.mbps, this.active);
    this.rider.style.setProperty('--jog-bob', period > 0 ? `${period}ms` : '0ms');
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.root.dataset.running = String(active);
    this.setRate(this.mbps);
    if (active) this.start();
    else this.stop();
  }

  destroy(): void {
    this.stop();
  }

  private start(): void {
    if (this.frame !== null) return;
    this.lastFrame = performance.now();
    const step = (now: number): void => {
      // Clamped: a tab returning from the background reports a gap of minutes,
      // which would throw the belt forward by half a mile in one frame.
      const dt = Math.min(64, now - this.lastFrame);
      this.lastFrame = now;
      this.phase += beltStep(this.mbps, this.active, dt);
      this.paint();
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  private stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private paint(): void {
    const span = ROLLERS.right.x - ROLLERS.left.x;
    const top = ROLLERS.left.y - ROLLER_R;
    const marks = treadOffsets(this.phase, span);
    this.treads.replaceChildren(
      ...marks.map((offset) => {
        const line = document.createElementNS(SVG_NS, 'line');
        const x = (ROLLERS.left.x + offset).toFixed(2);
        line.setAttribute('class', 'jog__tread');
        line.setAttribute('x1', x);
        line.setAttribute('x2', x);
        line.setAttribute('y1', top.toFixed(2));
        line.setAttribute('y2', (top + 4).toFixed(2));
        return line;
      }),
    );
    const angle = rollerAngle(this.phase).toFixed(2);
    for (const roller of this.rollers) {
      const spoke = roller.querySelector('.jog__roller-spoke');
      spoke?.setAttribute('transform', `rotate(${angle})`);
    }
  }
}

/** A coarse band for the stylesheet, so effort can be shown without numbers. */
function paceClass(mbps: number): string {
  const fraction = toFraction(mbps);
  if (fraction > 0.66) return 'fast';
  if (fraction > 0.33) return 'brisk';
  return 'easy';
}
