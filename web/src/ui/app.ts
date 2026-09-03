import { ApiClient } from '../api';
import type { Preferences } from '../core';
import type { ClientConfig, Peer, StoredResult } from '../domain/types';
import { measureLatency } from '../engine/latency';
import { Router } from '../routing';
import type { ThemeController } from '../theme';
import { Snackbar } from './components';
import {
  Hero,
  HistoryPanel,
  ResultView,
  SharePanel,
  StatTiles,
  TestController,
  TopBar,
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

  constructor(
    private readonly config: ClientConfig,
    private readonly api: ApiClient,
    theme: ThemeController,
    preferences: Preferences,
  ) {
    this.peer = config.servers?.find((server) => server.default) ?? null;

    this.hero = new Hero(
      preferences,
      () => void this.tests.run(this.peer),
      () => this.tests.abort(),
    );

    this.topBar = new TopBar(config, theme, {
      onHome: () => this.router.navigate('/'),
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
    void this.selectClosestPeer();
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

    this.main.replaceChildren(this.hero.root, this.stats.root, this.shareSlot, this.history.root);

    if (this.config.show_history) void this.history.refresh();
    else this.history.clear();

    if (this.config.auto_start && !this.tests.isRunning) void this.tests.run(this.peer);
  }

  private showResult(id: string): void {
    this.resultView?.destroy();
    this.resultView = new ResultView(this.api, this.snackbar, () => this.router.navigate('/'));
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
   * With several backends configured and none marked default, probe them and
   * keep the closest. Runs in the background; a failure leaves the selection
   * alone.
   */
  private async selectClosestPeer(): Promise<void> {
    const servers = this.config.servers ?? [];
    if (servers.length < 2 || servers.some((server) => server.default)) return;

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
