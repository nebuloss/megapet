import { clamp } from '../../../mech';
import { icon, type IconName } from '../../primitives/icons';
import { formatReadout, type Drive, type GaugeAccent, type SpeedVisual } from '../visual';
import { CAR, CAR_REST, LAND_MS, RING_LENGTH, SETTLE_MS, SHIFT_MS } from './layout';
import { LiftMachine } from './machine/machine';
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
 * genuinely disconnected from the pointer instead of being yanked about by it.
 *
 * Almost nothing of that is here. This owns the document — the figure, the
 * SVG, the readout under it — and the frame loop, and hands everything else
 * to `LiftMachine`, which knows no more about a browser than a mechanism
 * should. What is left is a `SpeedVisual`: commands in, one picture out.
 */
export class LiftVisual implements SpeedVisual {
  readonly root: HTMLElement;

  /** Long enough for the car to land and the belt to be walked across. */
  readonly transitionMs = LAND_MS + SHIFT_MS + SETTLE_MS;

  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly machine = new LiftMachine(() => this.reducedMotion.matches);
  private readonly scene: SvgScene;

  private readonly numberEl: HTMLElement;
  private readonly unitEl: HTMLElement;
  private readonly phaseEl: HTMLElement;

  /** An override for the number, for a phase the scale cannot show. */
  private reading: number | null = null;
  private unit = 'Mbps';

  private frame = 0;
  private dead = false;
  private lastFrameAt = 0;

  constructor() {
    this.root = document.createElement('figure');
    this.root.className = 'lift';
    this.root.dataset.drive = 'up';

    const host = document.createElement('div');
    host.className = 'lift__stage';
    host.innerHTML = liftMarkup(`lift-shaft-${++instanceCount}`);
    this.root.append(host);
    this.scene = new SvgScene(this.root, host.querySelector('svg')!);

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

    this.render();
  }

  // ------------------------------------------------------------- controls --

  setPosition(mbps: number): void {
    this.machine.aim(mbps);
    this.run();
  }

  setReading(value: number | null, unit: string): void {
    this.reading = value;
    this.unit = unit;
    this.render();
  }

  setDrive(direction: Drive): void {
    if (direction === this.machine.direction) return;
    this.root.dataset.drive = direction;
    this.machine.reverse(direction);
    this.run();
  }

  land(): void {
    this.machine.land();
    this.run();
  }

  /**
   * Calls the car up to the top of the shaft, and says how long it will take.
   *
   * This runs while the ping is taken: the phase is otherwise a still picture,
   * and a lift being called up is what a lift does before it carries anything.
   */
  open(): number {
    const ms = this.machine.ride(CAR.top);
    this.run();
    return ms;
  }

  /** Returns the car to the ground floor once the run is over. */
  park(): void {
    this.machine.ride(CAR_REST);
    this.run();
  }

  settleMs(): number {
    return this.machine.settleMs();
  }

  reset(): void {
    // Back to the resting colour. The upload leaves the machine on the
    // tertiary accent, and nothing else puts it back.
    this.setAccent('primary');
    this.reading = null;
    this.root.dataset.drive = 'up';
    this.machine.reset();
    this.setProgress(0);
    // Repainted at once rather than a frame later: the machine has just been
    // re-seated, and what is on screen is the end of a run that is over.
    this.render();
    this.run();
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
    // Terminal. `frame` alone cannot mean this, because the loop's guard is
    // `if (this.frame) return` — so any later setPosition would restart the
    // loop on a detached tree and animate it forever.
    this.dead = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  // ------------------------------------------------------------------ loop --

  /** Plays what the machine was just told to do, or shows it done. */
  private run(): void {
    if (this.reducedMotion.matches) this.render();
    else this.startLoop();
  }

  private startLoop(): void {
    if (this.dead || this.frame) return;
    this.lastFrameAt = 0;
    const step = (now: number): void => {
      // Driven by elapsed time, not by frames. Stepping a fixed fraction per
      // frame ran the machine at double speed on a 120Hz display and a quarter
      // of it on a phone dropping frames.
      const dt = this.lastFrameAt ? Math.min(64, now - this.lastFrameAt) : 16;
      this.lastFrameAt = now;

      const idle = this.machine.update(dt);
      this.render();
      if (idle) {
        this.frame = 0;
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /** One picture of the machine. Reads its state; never changes it. */
  private render(): void {
    this.machine.place(this.scene);
    // The unit is chosen with the number, so a gigabit link reads 8.74 Gbps
    // rather than 8741, and a slow one keeps its digits.
    const reading = formatReadout(this.reading ?? this.machine.reading, this.unit);
    this.numberEl.textContent = reading.value;
    if (this.unitEl.textContent !== reading.unit) this.unitEl.textContent = reading.unit;
  }
}
