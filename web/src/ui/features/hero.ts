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

    this.root.append(this.slot, el('div', { class: 'hero__actions' }, this.startButton), this.chips);
    hydrateRipples(this.root);
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
    this.startButton.innerHTML = icon(running ? 'stop' : 'speed');
    this.startButton.append(document.createTextNode(running ? 'Stop' : 'Start test'));
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
