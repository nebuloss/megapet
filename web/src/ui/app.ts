import { ApiClient } from '../api';
import type { Preferences } from '../core';
import type { ClientConfig, Peer, StoredResult } from '../domain/types';
import { measureLatency } from '../engine/latency';
import { Router } from '../routing';
import type { ThemeController } from '../theme';
import { Snackbar, confirm } from './components';
import {
  DIRECT_PEER_ID,
  GraphModal,
  Hero,
  ModeTabs,
  type Mode,
  HistoryPanel,
  MonitorPanel,
  ResultView,
  SharePanel,
  StatTiles,
  TestController,
  TopBar,
  directIsReachable,
  directPeer,
} from './features';
import { el } from './primitives/dom';
import { formatRate } from './primitives/format';

/**
 * The composition root.
 *
 * Deliberately thin: it constructs the pieces, wires them to each other and to
 * the router, and owns nothing but the small amount of state that genuinely
 * spans screens — which backend is selected, and the client's address. Every
 * behaviour of substance lives in a feature class, so this file stays readable
 * as the app grows.
 */
export class App {
  private readonly router = new Router();
  private readonly snackbar = new Snackbar();
  private readonly stats = new StatTiles();
  private readonly liveRegion = el('div', {
    class: 'visually-hidden',
    role: 'status',
    'aria-live': 'polite',
  });

  private readonly main = el('main', {});
  private readonly shareSlot = el('div', {});
  private readonly hero: Hero;
  private readonly topBar: TopBar;
  private readonly history: HistoryPanel;
  private readonly tests: TestController;
  private resultView: ResultView | null = null;
  private readonly monitor: MonitorPanel;
  private readonly modes: ModeTabs;
  /** The mode whose controls the main page shows, graph page included. */
  private mode: Mode = 'auto';
  private readonly graph: GraphModal;

  private peer: Peer | null;
  /** Configured backends, plus the server's own address when it is usable. */
  private peers: Peer[];

  constructor(
    private readonly config: ClientConfig,
    private readonly api: ApiClient,
    theme: ThemeController,
    preferences: Preferences,
  ) {
    this.peers = [...(config.servers ?? [])];
    this.peer = this.peers.find((server) => server.default) ?? null;

    this.hero = new Hero(
      preferences,
      () => void this.tests.run(this.peer),
      () => this.tests.abort(),
    );

    this.topBar = new TopBar(config, theme, {
      onHome: () => this.router.navigate('/'),
      peers: () => this.peers,
      onPeerChange: (peer) => {
        this.peer = peer;
        void this.refreshConnection();
      },
      onVisualChange: (kind) => this.hero.setVisual(kind),
      onGraph: () => this.toggleGraph(),
      currentPeer: () => this.peer,
      currentVisual: () => this.hero.visualKind,
    });

    this.history = new HistoryPanel(api, (result) => this.router.navigate(`/r/${result.id}`));

    this.tests = new TestController({
      api,
      params: config.test,
      storeEnabled: config.store_enabled,
      stats: this.stats,
      visual: () => this.hero.visual,
      setRunning: (running) => this.hero.setRunning(running),
      announce: (message) => {
        this.liveRegion.textContent = message;
      },
      notify: (message) => this.snackbar.show(message),
      onSaved: (result) => this.showShare(result),
      onActivity: (directions) => {
        this.modes.setRunning(directions ? 'auto' : null);
        this.monitor.setAutoRunning(directions !== null);
        // While the speed test holds the link the manual mode shows what it is
        // doing rather than the visitor's own setting, and keeps drawing.
        this.monitor.setBlocked(directions ? 'speedtest' : null, directions);
        if (!directions) this.monitor.refresh();
      },
      onSample: () => this.monitor.refresh(),
      onLive: (down, up) => this.monitor.setExternalLive(down, up),
    });

    this.graph = new GraphModal({ onClose: () => this.toggleGraph() });

    this.modes = new ModeTabs({
      onSelect: (mode) => void this.chooseMode(mode),

    });

    this.monitor = new MonitorPanel({
      params: config.test,
      peer: () => this.peer,
      baseFor: (peer) => (peer ? this.api.withBase(peer.url) : this.api).url(''),
      notify: (message) => this.snackbar.show(message),
      announce: (message) => {
        this.liveRegion.textContent = message;
      },
      recorded: () => this.tests.lastRun,
      onReadings: (down, up) => {
        // The tiles are the page's readout, whichever test is filling them.
        const d = formatRate(down);
        const u = formatRate(up);
        this.stats.set('download', d.value, d.unit);
        this.stats.set('upload', u.value, u.unit);
      },
      onAutoToggle: (start) => {
        if (start) void this.tests.run(this.peer);
        else this.tests.abort();
      },
      // One link, so one test at a time: a staged run and a continuous session
      // would each be measuring a link the other is already saturating. This
      // is said by disabling the other's button, with the reason on it, rather
      // than by interrupting anything.
      onRunningChange: (running) => {
        this.hero.setBlocked(running ? 'manual' : null);
        this.modes.setRunning(running ? 'manual' : null);
      },
    });
  }

  mount(root: HTMLElement): void {
    root.replaceChildren(
      el(
        'div',
        { class: 'app-shell' },
        this.topBar.root,
        this.modes.root,
        this.main,
        this.buildFooter(),
      ),
      this.graph.root,
      this.liveRegion,
    );

    this.router
      .add('/r/:id', ({ id }) => this.showResult(id ?? ''))
      .add('/manual', () => this.showHome('manual'))
      .fallback(() => this.showHome())
      .start();

    void this.refreshConnection();
    void this.offerDirect().then(() => this.selectClosestPeer());
  }

  destroy(): void {
    this.router.destroy();
    this.topBar.destroy();
    this.hero.destroy();
    this.resultView?.destroy();
    this.monitor.destroy();
    this.graph.destroy();
    this.snackbar.destroy();
  }

  // -------------------------------------------------------------- screens --

  /**
   * The one page there is.
   *
   * `graph` swaps the picture in the middle — the dial or manual's controls
   * become the plot — and changes nothing else: same mode tabs, same buttons,
   * same tiles, same history. That is the whole difference, and keeping it
   * that small is what stops the two views disagreeing about what is running.
   */
  private showHome(mode: Mode = 'auto'): void {
    this.mode = mode;
    this.resultView?.destroy();
    this.resultView = null;

    // The hero takes the first column and everything else stacks in the
    // second, so a wide screen is not a narrow strip down the middle.
    this.main.dataset.layout = 'split';
    this.main.replaceChildren(
      this.hero.root,
      el('div', { class: 'page-stack' }, this.stats.root, this.shareSlot, this.history.root),
    );

    this.modes.setMode(mode);
    this.modes.root.hidden = false;

    // Manual mode takes the dial's place: they are two ways of doing the same
    // thing, not two things to do. The graph is neither, and lives over the
    // page in a dialog.
    this.monitor.setMode(mode);
    if (mode === 'manual' && !this.graph.isOpen) {
      this.monitor.setTitle('Manual mode');
      this.monitor.setCompact(true);
      this.monitor.setShowGraph(false);
      this.hero.setManual(this.monitor.root);
    } else if (!this.graph.isOpen) {
      this.hero.setManual(null);
    }

    if (this.config.show_history) void this.history.refresh();
    else this.history.clear();

    if (this.config.auto_start && !this.tests.isRunning) void this.tests.run(this.peer);
  }

  /**
   * Opens or closes the graph over the page.
   *
   * The panel is moved into the dialog and back out again rather than rebuilt,
   * because that panel is the session: a new one would be drawing nothing.
   */
  private toggleGraph(): void {
    if (this.graph.isOpen) {
      const panel = this.graph.hide();
      this.topBar.setGraphActive(false);
      // Back where it belongs, which depends on the mode it returns to.
      if (panel && this.mode === 'manual') {
        this.monitor.setTitle('Manual mode');
        this.monitor.setShowGraph(false);
        this.hero.setManual(panel);
      } else {
        this.hero.setManual(null);
      }
      return;
    }

    this.monitor.setTitle('Graph');
    this.monitor.setShowGraph(true);
    this.monitor.setCompact(false);
    this.hero.setManual(null);
    this.graph.show(this.monitor.root);
    this.topBar.setGraphActive(true);
    this.monitor.refresh();
  }

  private showResult(id: string): void {
    // A saved result is neither mode, so the switch has nothing to say here.
    this.modes.root.hidden = true;
    this.topBar.setGraphActive(false);
    this.resultView?.destroy();
    this.resultView = new ResultView(this.api, this.snackbar, () => this.router.navigate('/'));
    this.main.dataset.layout = 'single';
    this.main.replaceChildren(this.resultView.root);
    void this.resultView.load(id);
  }

  /**
   * Switches mode, asking first if that would stop a running test.
   *
   * The two modes share one link, so entering the other kills whatever is
   * running now. That is worth a question — a manual session in particular
   * may have been left running for a long time, and there is no undo — but
   * only when there is actually something to lose, so an idle switch is
   * immediate.
   */
  private async chooseMode(mode: Mode): Promise<void> {
    // Changing mode on the graph page changes which mode the graph belongs to
    // and leaves you looking at the graph. Being thrown back to the controls
    // every time you touched the mode tabs made the graph feel like somewhere
    // you were only ever passing through.
    const path = this.pathFor(mode);
    const running = this.runningMode();
    if (running === null || running === mode) {
      this.commitMode(mode, path);
      return;
    }

    const isAuto = running === 'auto';
    const stop = await confirm({
      title: isAuto ? 'Stop the speed test?' : 'Stop manual mode?',
      body: isAuto
        ? 'A speed test is running. Switching to manual mode will stop it and ' +
          'the result will not be saved.'
        : 'Manual mode is still measuring. Switching to the speed test will ' +
          'stop it. Export the graph first if you want to keep it.',
      confirmLabel: 'Stop and switch',
      cancelLabel: 'Keep running',
      destructive: true,
    });
    if (!stop) return;

    if (isAuto) this.tests.abort();
    else this.monitor.stop();
    this.commitMode(mode, path);
  }

  /**
   * Applies the chosen mode and goes where it lives.
   *
   * On the graph page the path does not change with the mode, so the router
   * would treat the navigation as a no-op and the tabs would never repaint.
   * Setting the mode first covers both cases with one path through.
   */
  private commitMode(mode: Mode, path: string): void {
    this.applyMode(mode);
    this.router.navigate(path);
  }

  /** Where a mode's controls live. */
  private pathFor(mode: Mode): string {
    return mode === 'manual' ? '/manual' : '/';
  }

  /** Remembers the chosen mode and reflects it in the tabs. */
  private applyMode(mode: Mode): void {
    this.mode = mode;
    this.modes.setMode(mode);
    // With the graph open the panel is in the dialog; it still has to be told
    // which mode's controls it is presenting.
    if (this.graph.isOpen) {
      this.monitor.setMode(mode);
      this.monitor.refresh();
    }
  }

  /** Which mode is loading the link, if either. */
  private runningMode(): Mode | null {
    if (this.tests.isRunning) return 'auto';
    if (this.monitor.isRunning) return 'manual';
    return null;
  }

  /**
   * The continuous monitor, on a page of its own.
   *
   * The panel is built once and kept for the life of the app, so showing it
   * moves an existing element rather than making a new one. That is what lets
   * a session survive a trip to the speed test and back: leaving the page
   * stopped the session only because something used to stop it, and nothing
   * does now.
   */
  private showShare(result: StoredResult): void {
    this.shareSlot.replaceChildren(
      el(
        'section',
        { class: 'card card--flat' },
        el(
          'div',
          { class: 'section__head' },
          el('h2', { class: 'section__title' }, 'Share this result'),
        ),
        new SharePanel(result, this.snackbar).root,
      ),
    );
    if (this.config.show_history) void this.history.refresh();
  }

  private buildFooter(): HTMLElement {
    return el(
      'footer',
      { class: 'page-footer' },
      el('span', {}, `${this.config.title} · ${this.config.version}`),
    );
  }

  // ----------------------------------------------------------------- data --

  private async refreshConnection(): Promise<void> {
    try {
      this.hero.setConnection(await this.api.ip(), this.peer);
    } catch {
      // The chips fall back to just the server name.
      this.hero.setConnection(null, this.peer);
    }
  }

  /**
   * Offers the server's own address as a peer, if it advertised one and it
   * actually answers.
   *
   * Preferred automatically once reachable: an operator only advertises it in
   * order to be measured past the proxy, so selecting it is what enabling the
   * option meant. The proxy path stays in the menu, because "how fast is this
   * server through the front door" is a real question too.
   */
  private async offerDirect(): Promise<void> {
    const offer = directPeer(this.config);
    if (offer.status !== 'offered') return;
    if (!(await directIsReachable(offer.peer))) return;

    this.peers = [offer.peer, ...this.peers];
    if (!this.peer && !this.tests.isRunning) {
      this.peer = offer.peer;
      void this.refreshConnection();
    }
  }

  /**
   * With several backends configured and none marked default, probe them and
   * keep the closest. Runs in the background; a failure leaves the selection
   * alone.
   */
  private async selectClosestPeer(): Promise<void> {
    const servers = this.config.servers ?? [];
    if (servers.length < 2 || servers.some((server) => server.default)) return;
    // The direct address was chosen deliberately; do not second-guess it.
    if (this.peer?.id === DIRECT_PEER_ID) return;

    const controller = new AbortController();
    const probes = await Promise.allSettled(
      servers.map(async (server) => ({
        server,
        ping: (
          await measureLatency({
            base: ApiClient.normalizeBase(server.url),
            count: 3,
            warmup: 1,
            signal: controller.signal,
          })
        ).min,
      })),
    );

    let best: { server: Peer; ping: number } | null = null;
    for (const probe of probes) {
      if (probe.status !== 'fulfilled' || probe.value.ping <= 0) continue;
      if (!best || probe.value.ping < best.ping) best = probe.value;
    }
    if (best && !this.tests.isRunning) {
      this.peer = best.server;
      void this.refreshConnection();
    }
  }
}
