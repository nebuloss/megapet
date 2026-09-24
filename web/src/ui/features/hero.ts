import { Component, type Preferences } from '../../core';
import type { IpInfo, Peer } from '../../domain/types';
import { chip } from '../components';
import { el, hydrateRipples } from '../primitives/dom';
import { icon } from '../primitives/icons';
import { createVisual, readVisualKind, type SpeedVisual, type VisualKind } from '../visuals';

/**
 * The hero: whichever speed visual is mounted, the start button, and the
 * connection chips.
 *
 * It owns the visual's lifetime. Swapping between the lift and the dial
 * destroys the old instance and mounts a new one, which is why both are
 * constructed through the factory rather than held as fields — neither this
 * class nor anything above it names a concrete visual.
 */
export class Hero extends Component<HTMLElement> {
  private readonly slot = el('div', { class: 'hero__visual' });
  private readonly chips = el('div', { class: 'chip-row' });
  private readonly startButton: HTMLButtonElement;

  private kind: VisualKind;
  private mounted: SpeedVisual;
  private running = false;
  private blocked: 'manual' | null = null;
  private actions!: HTMLElement;

  constructor(
    private readonly preferences: Preferences,
    private readonly onStart: () => void,
    private readonly onStop: () => void,
  ) {
    super(el('section', { class: 'hero' }));

    this.kind = readVisualKind(preferences);
    this.mounted = this.mount(this.kind);

    this.startButton = el('button', {
      class: 'btn btn--start',
      type: 'button',
    }) as HTMLButtonElement;
    this.startButton.addEventListener('click', () => (this.running ? this.onStop() : this.onStart()));
    this.setRunning(false);

    this.actions = el('div', { class: 'hero__actions' }, this.startButton);
    this.root.append(this.slot, this.actions, this.chips);
    hydrateRipples(this.root);
  }

  /**
   * Puts manual mode's controls where the speed dial usually is.
   *
   * The two modes are alternatives, so they take the same place rather than
   * stacking: in manual mode the dial and its start button step aside for the
   * switches, and the mascot goes with them — manual mode brings its own.
   * Passing null restores auto mode.
   */
  setManual(controls: HTMLElement | null): void {
    this.root.dataset.mode = controls ? 'manual' : 'auto';
    if (controls) {
      this.root.replaceChildren(controls, this.chips);
    } else {
      this.root.replaceChildren(this.slot, this.actions, this.chips);
    }
  }

  /** The visual currently mounted. Valid until the next `setVisual`. */
  get visual(): SpeedVisual {
    return this.mounted;
  }

  get visualKind(): VisualKind {
    return this.kind;
  }

  setVisual(kind: VisualKind): void {
    if (kind === this.kind) return;
    this.kind = kind;
    this.preferences.set('visual', kind);
    this.mounted.destroy();
    this.mounted = this.mount(kind);
  }

  /** Switches the primary button between Start and Stop. */
  setRunning(running: boolean): void {
    this.running = running;
    this.paintStart();
  }

  /**
   * Blocks starting a run while manual mode is using the link.
   *
   * The two tests share one connection, so running both would have each
   * measuring a link the other is already saturating. Saying so on the button
   * is better than a dialog: it is visible before the click rather than after
   * it, and it costs nobody a decision.
   */
  setBlocked(reason: 'manual' | null): void {
    this.blocked = reason;
    this.paintStart();
  }

  private paintStart(): void {
    const blocked = this.blocked !== null && !this.running;
    this.startButton.disabled = blocked;
    this.startButton.innerHTML = icon(this.running ? 'stop' : 'speed');
    this.startButton.append(
      document.createTextNode(
        this.running ? 'Stop' : blocked ? 'Manual mode running' : 'Start test',
      ),
    );
    this.startButton.title = blocked
      ? 'Stop manual mode first — both would be measuring the same link.'
      : '';
  }

  setConnection(info: IpInfo | null, peer: Peer | null): void {
    const parts: HTMLElement[] = [];
    if (info?.ip) parts.push(chip('globe', info.ip));
    if (info?.isp) {
      parts.push(chip('info', [info.isp, info.city, info.country].filter(Boolean).join(', ')));
    }
    parts.push(chip('server', peer ? peer.name : 'This server'));
    this.chips.replaceChildren(...parts);
  }

  override destroy(): void {
    this.mounted.destroy();
  }

  private mount(kind: VisualKind): SpeedVisual {
    const visual = createVisual(kind);
    visual.setAccent('primary');
    visual.setReading(null, 'Mbps');
    this.slot.replaceChildren(visual.root);
    return visual;
  }
}
