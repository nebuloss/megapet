import type { ApiClient } from '../../api';
import { Component } from '../../core';
import type { StoredResult } from '../../domain/types';
import type { Snackbar } from '../components';
import { el, hydrateRipples } from '../primitives/dom';
import { formatBytes, formatDateTime, formatMs, formatSpeed } from '../primitives/format';
import { icon } from '../primitives/icons';
import { SharePanel } from './share-panel';
import { StatTiles } from './stat-tiles';

/**
 * A shared result, at `/r/:id`.
 *
 * Builds its own stat tiles rather than borrowing the live ones, so opening a
 * permalink never disturbs a run in progress — and so the view can be thrown
 * away wholesale when navigating on.
 */
export class ResultView extends Component<HTMLElement> {
  constructor(
    private readonly api: ApiClient,
    private readonly snackbar: Snackbar,
    private readonly onRunOwn: () => void,
  ) {
    super(el('div', { class: 'result-view' }));
    this.root.append(el('p', { class: 'empty-state' }, 'Loading result…'));
  }

  async load(id: string): Promise<void> {
    try {
      this.render(await this.api.result(id));
    } catch {
      this.renderMissing(id);
    }
  }

  private render(result: StoredResult): void {
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
    ]
      .filter(Boolean)
      .join(' · ');

    const transferred =
      `Transferred ${formatBytes(result.download_bytes)} down and ` +
      `${formatBytes(result.upload_bytes)} up · ` +
      `ping ${formatMs(result.ping_min_ms)}–${formatMs(result.ping_max_ms)} ms`;

    this.root.replaceChildren(
      el(
        'section',
        { class: 'card' },
        el(
          'div',
          { class: 'section__head' },
          el('h2', { class: 'section__title' }, `Result ${result.id}`),
        ),
        el('p', { class: 'result-note' }, meta),
      ),
      tiles.root,
      el(
        'section',
        { class: 'card' },
        el('p', { class: 'result-note' }, transferred),
        new SharePanel(result, this.snackbar).root,
      ),
      el('div', { class: 'share-row' }, this.runOwnButton()),
    );
    hydrateRipples(this.root);
  }

  private renderMissing(id: string): void {
    this.root.replaceChildren(
      el(
        'section',
        { class: 'card' },
        el('h2', { class: 'section__title' }, 'Result not found'),
        el(
          'p',
          { class: 'result-note' },
          `No stored result matches “${id}”. It may have been pruned.`,
        ),
        el('div', { class: 'share-row' }, this.runOwnButton('Run a test')),
      ),
    );
    hydrateRipples(this.root);
  }

  private runOwnButton(label = 'Run my own test'): HTMLElement {
    const button = el('button', {
      class: 'btn btn--tonal',
      type: 'button',
      html: icon('replay'),
    });
    button.append(document.createTextNode(label));
    button.addEventListener('click', () => this.onRunOwn());
    return button;
  }
}
