import { Component } from '../../core';
import { el, hydrateRipples } from '../primitives/dom';
import { icon, type IconName } from '../primitives/icons';

export type Mode = 'auto' | 'manual';

interface ModeSpec {
  readonly mode: Mode;
  readonly label: string;
  readonly hint: string;
  readonly icon: IconName;
}

const MODES: readonly ModeSpec[] = [
  {
    mode: 'auto',
    label: 'Auto',
    hint: 'One measured run: ping, download, upload, then a saved result.',
    icon: 'speed',
  },
  {
    mode: 'manual',
    label: 'Manual',
    hint: 'You choose the directions and how long it runs. Plots a graph.',
    icon: 'jitter',
  },
];

export interface ModeTabsHandlers {
  readonly onSelect: (mode: Mode) => void;
}

/**
 * The switch between the two kinds of test.
 *
 * A segmented control rather than a button that toggles: there are exactly two
 * modes, both are worth naming, and which one you are in should be readable
 * without pressing anything. The icon button it replaces could only say
 * "elsewhere", so the second mode was effectively hidden behind a tooltip.
 *
 * Each tab carries a live dot while its test is running, which is what makes
 * it safe to leave one going and look at the other — the tab bar is then the
 * one place that always says what the link is doing.
 */
export class ModeTabs extends Component<HTMLElement> {
  private readonly tabs = new Map<Mode, HTMLButtonElement>();
  private current: Mode = 'auto';
  private running: Mode | null = null;

  constructor(handlers: ModeTabsHandlers) {
    super(el('div', { class: 'modes' }));

    const tablist = el('div', {
      class: 'modes__tabs',
      role: 'tablist',
      'aria-label': 'Test mode',
    });

    for (const spec of MODES) {
      const tab = el('button', {
        class: 'modes__tab',
        type: 'button',
        role: 'tab',
        'aria-selected': 'false',
        title: spec.hint,
      }) as HTMLButtonElement;
      tab.append(
        el('span', { class: 'modes__icon', html: icon(spec.icon) }),
        el(
          'span',
          { class: 'modes__text' },
          el('span', { class: 'modes__label' }, spec.label),
          el('span', { class: 'modes__hint' }, spec.hint),
        ),
        el('span', { class: 'modes__live', 'aria-hidden': 'true' }),
      );
      tab.addEventListener('click', () => handlers.onSelect(spec.mode));
      this.tabs.set(spec.mode, tab);
      tablist.append(tab);
    }

    this.root.append(tablist);
    this.paint();
    hydrateRipples(this.root);
  }

  /** Which mode is on screen. */
  setMode(mode: Mode): void {
    this.current = mode;
    this.paint();
  }

  /** Which mode is currently loading the link, if either. */
  setRunning(mode: Mode | null): void {
    this.running = mode;
    this.paint();
  }

  private paint(): void {
    for (const [mode, tab] of this.tabs) {
      const selected = mode === this.current;
      const live = mode === this.running;
      tab.dataset.selected = String(selected);
      tab.dataset.live = String(live);
      tab.setAttribute('aria-selected', String(selected));
      // Screen readers get the running state in words; sighted users get the
      // dot, which is quieter and always in the same place.
      const spec = MODES.find((m) => m.mode === mode)!;
      tab.setAttribute('aria-label', live ? `${spec.label} — running` : spec.label);
    }
  }
}
