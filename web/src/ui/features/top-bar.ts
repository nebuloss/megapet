import { Component } from '../../core';
import type { ClientConfig, Peer } from '../../domain/types';
import { SEED_OPTIONS, type ThemeController, type ThemeMode } from '../../theme';
import { MenuButton, menuItem, menuLabel } from '../components';
import { el, hydrateRipples } from '../primitives/dom';
import { icon, sunIcon, type IconName } from '../primitives/icons';
import { VISUALS, type VisualKind } from '../visuals';

export interface TopBarHandlers {
  readonly onHome: () => void;
  /** Every backend the visitor may pick, direct address included. */
  readonly peers: () => readonly Peer[];
  readonly onPeerChange: (peer: Peer | null) => void;
  readonly onVisualChange: (kind: VisualKind) => void;
  /** Opens the graph, which both modes record into. */
  readonly onGraph: () => void;
  /** Reads the current selections, so menus reflect live state when opened. */
  readonly currentPeer: () => Peer | null;
  readonly currentVisual: () => VisualKind;
}

const MODES: readonly [ThemeMode, string, IconName][] = [
  ['light', 'Light', 'sunCircle'],
  ['dark', 'Dark', 'moon'],
  ['system', 'System', 'contrast'],
];

/** The application bar: brand, server picker, quick theme toggle, settings. */
export class TopBar extends Component<HTMLElement> {
  private readonly themeToggle: HTMLButtonElement;
  private graphButton: HTMLButtonElement | null = null;
  private modeSlot!: HTMLElement;
  private readonly menus: MenuButton[] = [];
  private readonly onScroll = (): void => {
    this.root.dataset.scrolled = String(window.scrollY > 4);
  };

  constructor(
    private readonly config: ClientConfig,
    private readonly theme: ThemeController,
    private readonly handlers: TopBarHandlers,
  ) {
    super(el('header', { class: 'top-bar', 'data-scrolled': 'false' }));

    this.themeToggle = this.buildThemeToggle();
    const actions: HTMLElement[] = [this.buildGraphButton()];
    if (handlers.peers().length > 0) actions.push(this.buildServerMenu().root);
    actions.push(this.themeToggle, this.buildSettingsMenu().root);

    // The mode switch sits between the brand and the actions: it is the
    // page's primary choice, so it belongs with the identity rather than
    // among the settings controls.
    this.modeSlot = el('div', { class: 'top-bar__modes' });
    this.root.append(
      el('div', { class: 'top-bar__inner' }, this.buildBrand(), this.modeSlot, ...actions),
    );
    hydrateRipples(this.root);

    window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  override destroy(): void {
    window.removeEventListener('scroll', this.onScroll);
    for (const menu of this.menus) menu.destroy();
  }

  private buildBrand(): HTMLElement {
    const brand = el(
      'a',
      { class: 'brand', href: '/', 'aria-label': `${this.config.title} home` },
      el('span', { class: 'brand__mark', html: icon('speed') }),
      el('span', { class: 'brand__title' }, this.config.title),
    );
    brand.addEventListener('click', (event) => {
      event.preventDefault();
      this.handlers.onHome();
    });
    return brand;
  }

  /**
   * The graph, which belongs to neither mode and to both.
   *
   * It lives up here rather than beside the mode tabs because it is not a
   * choice of mode — it is the record of what every mode has measured, so it
   * should be reachable from anywhere in the app, the graph page included.
   */
  private buildGraphButton(): HTMLButtonElement {
    const button = el('button', {
      // `data-control` is a stable hook: the title and label below say which
      // way the button currently points, so neither identifies it.
      class: 'icon-button',
      type: 'button',
      'data-control': 'graph',
      'aria-pressed': 'false',
      title: 'Graph',
      'aria-label': 'Show the graph of everything measured so far',
      html: icon('jitter'),
    }) as HTMLButtonElement;
    button.addEventListener('click', () => this.handlers.onGraph());
    this.graphButton = button;
    return button;
  }

  /**
   * Puts the mode switch in the bar, or takes it out.
   *
   * Removed on screens that have no mode — a saved result is neither auto nor
   * manual, and a switch offering a choice that does not apply is worse than
   * no switch.
   */
  setModes(modes: HTMLElement | null): void {
    if (modes) this.modeSlot.replaceChildren(modes);
    else this.modeSlot.replaceChildren();
  }

  /** Marks the graph as the thing currently on screen. */
  setGraphActive(active: boolean): void {
    this.graphButton?.setAttribute('aria-pressed', String(active));
    if (this.graphButton) this.graphButton.dataset.active = String(active);
  }

  /** One tap between light and dark; the full three-way choice is in settings. */
  private buildThemeToggle(): HTMLButtonElement {
    const button = el('button', {
      class: 'icon-button',
      type: 'button',
      title: 'Toggle light and dark',
      'aria-label': 'Toggle light and dark',
    }) as HTMLButtonElement;

    const paint = (): void => {
      button.innerHTML = this.theme.isDark ? sunIcon() : icon('moon');
    };
    paint();
    button.addEventListener('click', () => {
      this.theme.toggleMode();
      paint();
    });
    return button;
  }

  private buildServerMenu(): MenuButton {
    const menu = new MenuButton('server', 'Choose a test server', (close) => {
      const selected = this.handlers.currentPeer();
      const options: (Peer | null)[] = [null, ...this.handlers.peers()];
      return [
        menuLabel('Test server'),
        ...options.map((option) =>
          menuItem({
            label: option ? option.name : 'This server',
            ...(option?.location ? { sub: option.location } : {}),
            iconHtml: icon(option ? 'globe' : 'server'),
            checked: (selected?.id ?? null) === (option?.id ?? null),
            onSelect: () => {
              this.handlers.onPeerChange(option);
              close();
            },
          }),
        ),
      ];
    });
    this.menus.push(menu);
    return menu;
  }

  private buildSettingsMenu(): MenuButton {
    const menu = new MenuButton('palette', 'Appearance settings', (close) => [
      menuLabel('Appearance'),
      ...MODES.map(([mode, label, iconName]) =>
        menuItem({
          label,
          iconHtml: mode === 'light' ? sunIcon() : icon(iconName),
          checked: this.theme.currentMode === mode,
          onSelect: () => {
            this.theme.setMode(mode);
            close();
          },
        }),
      ),
      menuLabel('Accent colour'),
      this.buildSwatches(close),
      menuLabel('Speed display'),
      ...VISUALS.map((visual) =>
        menuItem({
          label: visual.label,
          sub: visual.description,
          iconHtml: icon(visual.kind === 'lift' ? 'server' : 'speed'),
          checked: this.handlers.currentVisual() === visual.kind,
          onSelect: () => {
            this.handlers.onVisualChange(visual.kind);
            close();
          },
        }),
      ),
    ]);
    this.menus.push(menu);
    return menu;
  }

  private buildSwatches(close: () => void): HTMLElement {
    const swatches = el('div', { class: 'swatches' });
    for (const option of SEED_OPTIONS) {
      const swatch = el('button', {
        class: 'swatch',
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': String(this.theme.currentSeed.toLowerCase() === option.hex.toLowerCase()),
        'aria-label': option.name,
        title: option.name,
        style: `background:${option.hex}`,
        html: icon('check'),
      });
      swatch.addEventListener('click', () => {
        this.theme.setSeed(option.hex);
        close();
      });
      swatches.append(swatch);
    }
    return swatches;
  }
}
