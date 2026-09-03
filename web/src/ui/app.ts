import { ApiClient } from '../api';
import type { Preferences } from '../core';
import type { ClientConfig, Peer, StoredResult } from '../domain/types';
import { measureLatency } from '../engine/latency';
import { Router } from '../routing';
import type { ThemeController } from '../theme';
import { Snackbar } from './components';
import {
  DIRECT_PEER_ID,
  Hero,
  HistoryPanel,
  ResultView,
  SharePanel,
  StatTiles,
  TestController,
  TopBar,
  directIsReachable,
  directPeer,
} from './features';
import { el } from './primitives/dom';

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
    });
  }

  mount(root: HTMLElement): void {
    root.replaceChildren(
      el('div', { class: 'app-shell' }, this.topBar.root, this.main, this.buildFooter()),
      this.liveRegion,
    );

    this.router
      .add('/r/:id', ({ id }) => this.showResult(id ?? ''))
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
    this.snackbar.destroy();
  }

  // -------------------------------------------------------------- screens --

  private showHome(): void {
    this.resultView?.destroy();
    this.resultView = null;

    // The hero takes the first column and everything else stacks in the
    // second, so a wide screen is not a narrow strip down the middle.
    this.main.dataset.layout = 'split';
    this.main.replaceChildren(
      this.hero.root,
      el('div', { class: 'page-stack' }, this.stats.root, this.shareSlot, this.history.root),
    );

    if (this.config.show_history) void this.history.refresh();
    else this.history.clear();

    if (this.config.auto_start && !this.tests.isRunning) void this.tests.run(this.peer);
  }

  private showResult(id: string): void {
    this.resultView?.destroy();
    this.resultView = new ResultView(this.api, this.snackbar, () => this.router.navigate('/'));
    this.main.dataset.layout = 'single';
    this.main.replaceChildren(this.resultView.root);
    void this.resultView.load(id);
  }

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
