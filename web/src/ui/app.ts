import {
  fetchIp,
  fetchSummary,
  getResult,
  listResults,
  normalizeBase,
  saveResult,
  type Submission,
} from '../api';
import { measureLatency } from '../engine/latency';
import { SpeedTest, type Phase, type Snapshot } from '../engine/runner';
import { describePlatform, formatBytes, formatDateTime, formatMs, formatSpeed } from '../format';
import { SEED_OPTIONS, getMode, getSeed, isDark, setMode, setSeed, type ThemeMode } from '../theme';
import type { ClientConfig, IpInfo, Peer, StoredResult } from '../types';
import { clear, el, hydrateRipples } from './dom';
import { Gauge } from './gauge';
import { renderHistory, renderSummary } from './history';
import { icon, sunIcon, type IconName } from './icons';
import { LiftScene } from './liftscene';
import { toast } from './snackbar';
import { StatTiles } from './stats';
import type { Drive, GaugeAccent, SpeedVisual } from './visual';

type VisualKind = 'lift' | 'dial';

const VISUAL_KEY = 'speedtest.visual';
const HISTORY_DAYS = 30;
const HISTORY_LIMIT = 25;

interface PhaseStyle {
  label: string;
  icon: IconName;
  accent: GaugeAccent;
  unit: string;
  tile: 'download' | 'upload' | 'ping' | null;
  /** Which way the lift travels while this phase runs. */
  drive: Drive;
}

const PHASES: Record<Phase, PhaseStyle | null> = {
  idle: null,
  // Handled separately: its direction comes from the phase it is setting up.
  reversing: null,
  latency: {
    label: 'Latency', icon: 'latency', accent: 'secondary',
    unit: 'ms', tile: 'ping', drive: 'up',
  },
  // Bytes coming down the wire send the car down the shaft, and going back up
  // for the upload phase is what the reversing gear is for.
  download: {
    label: 'Download', icon: 'download', accent: 'primary',
    unit: 'Mbps', tile: 'download', drive: 'down',
  },
  upload: {
    label: 'Upload', icon: 'upload', accent: 'tertiary',
    unit: 'Mbps', tile: 'upload', drive: 'up',
  },
  done: null,
  aborted: null,
  error: null,
};

export class App {
  private readonly stats = new StatTiles();
  private readonly liveRegion = el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  private readonly main = el('main', {});
  private readonly topBar: HTMLElement;

  private visual!: SpeedVisual;
  private visualKind: VisualKind;
  private visualSlot = el('div', { class: 'hero__visual' });

  private test: SpeedTest | null = null;
  private running = false;
  private peer: Peer | null = null;
  private ipInfo: IpInfo | null = null;

  private startButton!: HTMLButtonElement;
  private chipRow = el('div', { class: 'chip-row' });
  private shareSlot = el('div', {});
  private historySlot = el('section', { class: 'section' });

  constructor(private readonly config: ClientConfig) {
    this.visualKind = readVisualKind();
    this.peer = pickDefaultPeer(config.servers);
    this.topBar = this.buildTopBar();
    this.mountVisual();
  }

  mount(root: HTMLElement): void {
    clear(root);
    root.append(
      el('div', { class: 'app-shell' }, this.topBar, this.main, this.buildFooter()),
      this.liveRegion,
    );

    window.addEventListener('scroll', () => {
      this.topBar.dataset.scrolled = String(window.scrollY > 4);
    }, { passive: true });

    this.route(window.location.pathname);
    window.addEventListener('popstate', () => this.route(window.location.pathname));

    void this.loadIpInfo();
    void this.autoSelectPeer();
  }

  /** Renders the view matching a path. Only /r/{id} differs from the home view. */
  route(pathname: string): void {
    const shared = /^\/r\/([0-9A-Za-z]+)\/?$/.exec(pathname);
    if (shared?.[1]) {
      this.renderSharedResult(shared[1]);
      return;
    }
    this.renderHome();
  }

  private navigate(path: string): void {
    if (window.location.pathname === path) return;
    window.history.pushState(null, '', path);
    this.route(path);
  }

  // ------------------------------------------------------------ chrome ---

  private buildTopBar(): HTMLElement {
    const brand = el(
      'a',
      { class: 'brand', href: '/', 'aria-label': `${this.config.title} home` },
      el('span', { class: 'brand__mark', html: icon('speed') }),
      el('span', { class: 'brand__title' }, this.config.title),
    );
    brand.addEventListener('click', (event) => {
      event.preventDefault();
      this.navigate('/');
    });

    const actions: HTMLElement[] = [];
    if ((this.config.servers ?? []).length > 0) {
      actions.push(this.buildServerMenu());
    }
    actions.push(this.buildThemeToggle(), this.buildSettingsMenu());

    const bar = el(
      'header',
      { class: 'top-bar', 'data-scrolled': 'false' },
      el('div', { class: 'top-bar__inner' }, brand, ...actions),
    );
    hydrateRipples(bar);
    return bar;
  }

  private buildFooter(): HTMLElement {
    return el(
      'footer',
      { class: 'page-footer' },
      el('span', {}, `${this.config.title} · ${this.config.version}`),
    );
  }

  /** A one-tap light/dark switch, with the full three-way choice in settings. */
  private buildThemeToggle(): HTMLElement {
    const button = el('button', {
      class: 'icon-button',
      type: 'button',
      title: 'Toggle light and dark',
      'aria-label': 'Toggle light and dark',
    });
    const paint = (): void => {
      button.innerHTML = isDark() ? sunIcon() : icon('moon');
    };
    paint();
    button.addEventListener('click', () => {
      setMode(isDark() ? 'light' : 'dark');
      paint();
    });
    return button;
  }

  private buildServerMenu(): HTMLElement {
    const servers = this.config.servers ?? [];
    return menuButton('server', 'Choose a test server', (close) => {
      const items: HTMLElement[] = [el('div', { class: 'menu__label' }, 'Test server')];
      const options: (Peer | null)[] = [null, ...servers];
      for (const option of options) {
        const selected = (this.peer?.id ?? null) === (option?.id ?? null);
        const item = el(
          'button',
          { class: 'menu__item', type: 'button', role: 'menuitemradio', 'aria-checked': String(selected) },
          el('span', { html: icon(option ? 'globe' : 'server') }),
          el(
            'span',
            {},
            el('span', {}, option ? option.name : 'This server'),
            option?.location ? el('span', { class: 'menu__item-sub' }, option.location) : null,
          ),
        );
        item.addEventListener('click', () => {
          this.peer = option;
          this.renderChips();
          close();
        });
        items.push(item);
      }
      return items;
    });
  }

  private buildSettingsMenu(): HTMLElement {
    return menuButton('palette', 'Appearance settings', (close) => {
      const items: HTMLElement[] = [];

      items.push(el('div', { class: 'menu__label' }, 'Appearance'));
      const modes: [ThemeMode, string, IconName][] = [
        ['light', 'Light', 'sunCircle'],
        ['dark', 'Dark', 'moon'],
        ['system', 'System', 'contrast'],
      ];
      for (const [mode, label, iconName] of modes) {
        const item = el(
          'button',
          { class: 'menu__item', type: 'button', role: 'menuitemradio', 'aria-checked': String(getMode() === mode) },
          el('span', { html: mode === 'light' ? sunIcon() : icon(iconName) }),
          el('span', {}, label),
        );
        item.addEventListener('click', () => {
          setMode(mode);
          close();
        });
        items.push(item);
      }

      items.push(el('div', { class: 'menu__label' }, 'Accent colour'));
      const swatches = el('div', { class: 'swatches' });
      for (const option of SEED_OPTIONS) {
        const swatch = el('button', {
          class: 'swatch',
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': String(getSeed().toLowerCase() === option.hex.toLowerCase()),
          'aria-label': option.name,
          title: option.name,
          style: `background:${option.hex}`,
          html: icon('check'),
        });
        swatch.addEventListener('click', () => {
          setSeed(option.hex);
          close();
        });
        swatches.append(swatch);
      }
      items.push(swatches);

      items.push(el('div', { class: 'menu__label' }, 'Speed display'));
      const visuals: [VisualKind, string, string][] = [
        ['lift', 'Geared lift', 'The needle drives Nookies up the shaft'],
        ['dial', 'Plain dial', 'Just the circular gauge'],
      ];
      for (const [kind, label, sub] of visuals) {
        const item = el(
          'button',
          { class: 'menu__item', type: 'button', role: 'menuitemradio', 'aria-checked': String(this.visualKind === kind) },
          el('span', { html: icon(kind === 'lift' ? 'server' : 'speed') }),
          el('span', {}, el('span', {}, label), el('span', { class: 'menu__item-sub' }, sub)),
        );
        item.addEventListener('click', () => {
          this.setVisualKind(kind);
          close();
        });
        items.push(item);
      }

      return items;
    });
  }

  // ------------------------------------------------------------- views ---

  private renderHome(): void {
    const hero = el('section', { class: 'hero' }, this.visualSlot, this.buildActions(), this.chipRow);
    clear(this.main);
    this.main.append(hero, this.stats.root, this.shareSlot, this.historySlot);
    hydrateRipples(this.main);
    this.renderChips();

    if (this.config.show_history) {
      void this.refreshHistory();
    } else {
      clear(this.historySlot);
    }
    if (this.config.auto_start && !this.running) {
      void this.runTest();
    }
  }

  private buildActions(): HTMLElement {
    this.startButton = el('button', { class: 'btn btn--start', type: 'button' }) as HTMLButtonElement;
    this.startButton.addEventListener('click', () => {
      if (this.running) {
        this.test?.abort();
      } else {
        void this.runTest();
      }
    });
    this.setStartButton(this.running ? 'stop' : 'start');
    return el('div', { class: 'hero__actions' }, this.startButton);
  }

  private renderChips(): void {
    clear(this.chipRow);
    const info = this.ipInfo;
    if (info?.ip) {
      this.chipRow.append(chip('globe', info.ip));
    }
    if (info?.isp) {
      this.chipRow.append(chip('info', [info.isp, info.city, info.country].filter(Boolean).join(', ')));
    }
    this.chipRow.append(chip('server', this.peer ? this.peer.name : 'This server'));
  }

  private async renderSharedResult(id: string): Promise<void> {
    clear(this.main);
    this.main.append(el('p', { class: 'empty-state' }, 'Loading result…'));

    let result: StoredResult;
    try {
      result = await getResult(id);
    } catch {
      clear(this.main);
      const back = el('button', { class: 'btn btn--tonal', type: 'button' }, 'Run a test');
      back.addEventListener('click', () => this.navigate('/'));
      this.main.append(
        el('section', { class: 'card' },
          el('h2', { class: 'section__title' }, 'Result not found'),
          el('p', { class: 'result-note' }, `No stored result matches “${id}”. It may have been pruned.`),
          el('div', { class: 'share-row' }, back),
        ),
      );
      hydrateRipples(this.main);
      return;
    }

    const tiles = new StatTiles();
    tiles.set('download', formatSpeed(result.download_mbps));
    tiles.set('upload', formatSpeed(result.upload_mbps));
    tiles.set('ping', formatMs(result.ping_ms));
    tiles.set('jitter', formatMs(result.jitter_ms));

    const meta = [
      formatDateTime(result.created_at),
      result.isp,
      result.server_name,
      result.platform,
    ].filter(Boolean).join(' · ');

    const again = el('button', { class: 'btn btn--tonal', type: 'button', html: icon('replay') });
    again.append(document.createTextNode('Run my own test'));
    again.addEventListener('click', () => this.navigate('/'));

    clear(this.main);
    this.main.append(
      el('section', { class: 'card' },
        el('div', { class: 'section__head' }, el('h2', { class: 'section__title' }, `Result ${result.id}`)),
        el('p', { class: 'result-note' }, meta),
      ),
      tiles.root,
      el('section', { class: 'card' },
        el('p', { class: 'result-note' },
          `Transferred ${formatBytes(result.download_bytes)} down and ${formatBytes(result.upload_bytes)} up · ` +
          `ping ${formatMs(result.ping_min_ms)}–${formatMs(result.ping_max_ms)} ms`),
        this.buildShareRow(result),
      ),
      el('div', { class: 'share-row' }, again),
    );
    hydrateRipples(this.main);
  }

  private buildShareRow(result: StoredResult): HTMLElement {
    const url = result.url ?? `${window.location.origin}/r/${result.id}`;
    const link = el('div', { class: 'share-link', title: url }, url);

    const copy = el('button', { class: 'btn btn--tonal', type: 'button', html: icon('copy') });
    copy.append(document.createTextNode('Copy link'));
    copy.addEventListener('click', () => void copyToClipboard(url));

    const card = el('a', {
      class: 'btn btn--outlined',
      href: result.card_url ?? `/api/results/${result.id}/card.svg`,
      target: '_blank',
      rel: 'noopener',
      html: icon('image'),
    });
    card.append(document.createTextNode('Image card'));

    const row = el('div', { class: 'share-row' }, link, copy, card);
    hydrateRipples(row);
    return row;
  }

  // ------------------------------------------------------------ running ---

  private async runTest(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stats.reset();
    clear(this.shareSlot);
    this.visual.reset();
    this.visual.setActive(true);
    this.setStartButton('stop');

    const base = this.peer ? normalizeBase(this.peer.url) : '';
    // The visual decides how long the between-phase pause needs to be.
    this.test = new SpeedTest(this.config.test, base, this.visual.transitionMs);

    let lastPhase: Phase = 'idle';
    const snapshot = await this.test.run((s) => {
      if (s.phase !== lastPhase) {
        lastPhase = s.phase;
        this.applyPhase(s);
      }
      this.applySnapshot(s);
    });

    this.running = false;
    this.test = null;
    this.visual.setActive(false);
    this.setStartButton('start');
    this.stats.setActive(null);

    if (snapshot.phase === 'error') {
      this.visual.setPhase('Failed', 'close');
      this.announce('The test failed.');
      toast(snapshot.error ?? 'The test failed.');
      return;
    }
    if (snapshot.phase === 'aborted') {
      this.visual.setPhase('Stopped', 'stop');
      this.announce('Test stopped.');
      return;
    }

    this.visual.setPhase('Complete', 'check');
    this.announce(
      `Test complete. Download ${formatSpeed(snapshot.downloadMbps)} megabits per second, ` +
        `upload ${formatSpeed(snapshot.uploadMbps)}, ping ${formatMs(snapshot.pingMs)} milliseconds.`,
    );
    await this.persist(snapshot);
  }

  private applyPhase(s: Snapshot): void {
    if (s.phase === 'reversing') {
      // Selected before the reading is applied, so the gear shift re-anchors
      // on where the car actually is rather than moving it.
      this.visual.setDrive(s.nextPhase === 'download' ? 'down' : 'up');
      this.visual.setAccent('secondary');
      this.visual.setPhase('Reversing', 'replay');
      this.visual.setReading(null, 'Mbps');
      this.stats.setActive(null);
      this.announce(`Reversing the drive for the ${s.nextPhase ?? 'next'} test.`);
      return;
    }

    const style = PHASES[s.phase];
    if (!style) return;
    this.visual.setDrive(style.drive);
    this.visual.setAccent(style.accent);
    this.visual.setPhase(style.label, style.icon);
    this.visual.setReading(style.unit === 'ms' ? 0 : null, style.unit);
    this.stats.setActive(style.tile);
    this.announce(`${style.label} test running.`);
  }

  private applySnapshot(s: Snapshot): void {
    this.visual.setProgress(s.progress);

    if (s.phase === 'reversing') {
      // The reading is pinned at zero here so the machine can be seen changing
      // over; the tiles keep whatever the last phase measured.
      this.visual.setPosition(0);
      return;
    }

    if (s.phase === 'latency') {
      // Milliseconds have no place on a throughput scale, so the lift stays put
      // and only the readout tracks the probe.
      this.visual.setReading(s.pingMs, 'ms');
      this.visual.setPosition(0);
      this.stats.set('ping', formatMs(s.pingMs));
      return;
    }

    this.visual.setReading(null, 'Mbps');
    this.visual.setPosition(s.liveMbps);
    this.stats.set('download', formatSpeed(s.downloadMbps));
    this.stats.set('upload', formatSpeed(s.uploadMbps));
    this.stats.set('ping', formatMs(s.pingMs));
    this.stats.set('jitter', formatMs(s.jitterMs));
  }

  private async persist(snapshot: Snapshot): Promise<void> {
    if (!this.config.store_enabled) return;

    const body: Submission = {
      download_mbps: snapshot.downloadMbps,
      upload_mbps: snapshot.uploadMbps,
      ping_ms: snapshot.pingMs,
      jitter_ms: snapshot.jitterMs,
      ping_min_ms: snapshot.pingMinMs,
      ping_max_ms: snapshot.pingMaxMs,
      download_bytes: snapshot.downloadBytes,
      upload_bytes: snapshot.uploadBytes,
      platform: describePlatform(),
      server_id: this.peer?.id ?? '',
      server_name: this.peer?.name ?? 'This server',
      note: '',
    };

    try {
      const saved = await saveResult(body);
      clear(this.shareSlot);
      this.shareSlot.append(
        el('section', { class: 'card card--flat' },
          el('div', { class: 'section__head' }, el('h2', { class: 'section__title' }, 'Share this result')),
          this.buildShareRow(saved),
        ),
      );
      if (this.config.show_history) void this.refreshHistory();
    } catch (err) {
      toast(`Result not saved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private setStartButton(state: 'start' | 'stop'): void {
    this.startButton.innerHTML = icon(state === 'stop' ? 'stop' : 'speed');
    this.startButton.append(document.createTextNode(state === 'stop' ? 'Stop' : 'Start test'));
  }

  // -------------------------------------------------------------- data ---

  private async loadIpInfo(): Promise<void> {
    try {
      this.ipInfo = await fetchIp();
      this.renderChips();
    } catch {
      /* the chips simply stay minimal */
    }
  }

  /**
   * When several backends are configured and none is marked default, probe them
   * and keep the closest one.
   */
  private async autoSelectPeer(): Promise<void> {
    const servers = this.config.servers ?? [];
    if (servers.length < 2 || servers.some((s) => s.default)) return;

    const controller = new AbortController();
    const probes = await Promise.allSettled(
      servers.map(async (server) => {
        const latency = await measureLatency({
          base: normalizeBase(server.url),
          count: 3,
          warmup: 1,
          signal: controller.signal,
        });
        return { server, ping: latency.min };
      }),
    );

    let best: { server: Peer; ping: number } | null = null;
    for (const probe of probes) {
      if (probe.status !== 'fulfilled' || probe.value.ping <= 0) continue;
      if (!best || probe.value.ping < best.ping) best = probe.value;
    }
    if (best && !this.running) {
      this.peer = best.server;
      this.renderChips();
    }
  }

  private async refreshHistory(): Promise<void> {
    try {
      const [results, summary] = await Promise.all([
        listResults({ limit: HISTORY_LIMIT, days: HISTORY_DAYS }),
        fetchSummary(HISTORY_DAYS),
      ]);

      clear(this.historySlot);
      this.historySlot.append(
        el('div', { class: 'section__head' }, el('h2', { class: 'section__title' }, 'Recent tests')),
      );
      const summaryRow = renderSummary(summary, HISTORY_DAYS);
      if (summaryRow) this.historySlot.append(summaryRow);
      this.historySlot.append(renderHistory(results, (r) => this.navigate(`/r/${r.id}`)));
      hydrateRipples(this.historySlot);
    } catch {
      clear(this.historySlot);
    }
  }

  // ------------------------------------------------------------ visual ---

  private mountVisual(): void {
    this.visual?.destroy();
    this.visual = this.visualKind === 'dial' ? new Gauge() : new LiftScene();
    this.visual.setAccent('primary');
    this.visual.setReading(null, 'Mbps');
    clear(this.visualSlot);
    this.visualSlot.append(this.visual.root);
  }

  private setVisualKind(kind: VisualKind): void {
    if (kind === this.visualKind) return;
    this.visualKind = kind;
    try {
      localStorage.setItem(VISUAL_KEY, kind);
    } catch {
      /* preference simply will not persist */
    }
    this.mountVisual();
  }

  private announce(message: string): void {
    this.liveRegion.textContent = message;
  }
}

// ---------------------------------------------------------------- helpers ---

function chip(name: IconName, text: string): HTMLElement {
  return el('span', { class: 'chip', title: text, html: icon(name) }, el('span', {}, text));
}

function pickDefaultPeer(servers: Peer[] | null): Peer | null {
  return servers?.find((s) => s.default) ?? null;
}

function readVisualKind(): VisualKind {
  try {
    return localStorage.getItem(VISUAL_KEY) === 'dial' ? 'dial' : 'lift';
  } catch {
    return 'lift';
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied to the clipboard.');
  } catch {
    toast('Could not copy — select the link and copy it manually.');
  }
}

/**
 * An icon button that opens a popup menu, built lazily so it always reflects
 * current state, and closed by Escape or a click elsewhere.
 */
function menuButton(
  iconName: IconName,
  label: string,
  build: (close: () => void) => HTMLElement[],
): HTMLElement {
  const anchor = el('div', { class: 'menu-anchor' });
  const button = el('button', {
    class: 'icon-button',
    type: 'button',
    title: label,
    'aria-label': label,
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    html: icon(iconName),
  });
  anchor.append(button);

  let menu: HTMLElement | null = null;

  const close = (): void => {
    menu?.remove();
    menu = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };

  function onOutside(event: PointerEvent): void {
    if (!anchor.contains(event.target as Node)) close();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      close();
      button.focus();
    }
  }

  button.addEventListener('click', () => {
    if (menu) {
      close();
      return;
    }
    menu = el('div', { class: 'menu', role: 'menu' }, ...build(close));
    anchor.append(menu);
    hydrateRipples(menu);
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  });

  return anchor;
}
