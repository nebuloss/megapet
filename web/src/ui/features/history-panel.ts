import type { ApiClient } from '../../api';
import { Component } from '../../core';
import type { StoredResult, Summary } from '../../domain/types';
import { el, hydrateRipples } from '../primitives/dom';
import { formatMs, formatRelative, formatSpeed } from '../primitives/format';
import { icon } from '../primitives/icons';

const WINDOW_DAYS = 30;
const PAGE_SIZE = 25;

/**
 * Recent results, with a strip of rolling averages above them.
 *
 * Fetches its own data: the panel knows what it needs and nothing else has to
 * care, which keeps the composition root free of data plumbing. A failed
 * refresh empties the panel rather than showing a broken one, because a
 * history is a nicety and should never be the reason a page looks wrong.
 */
export class HistoryPanel extends Component {
  constructor(
    private readonly api: ApiClient,
    private readonly onSelect: (result: StoredResult) => void,
  ) {
    super(el('section', { class: 'section' }));
  }

  async refresh(): Promise<void> {
    try {
      const [results, summary] = await Promise.all([
        this.api.results({ limit: PAGE_SIZE, days: WINDOW_DAYS }),
        this.api.summary(WINDOW_DAYS),
      ]);
      this.render(results, summary);
    } catch {
      this.clear();
    }
  }

  clear(): void {
    this.root.replaceChildren();
  }

  private render(results: StoredResult[], summary: Summary): void {
    const children: (HTMLElement | null)[] = [
      el('div', { class: 'section__head' }, el('h2', { class: 'section__title' }, 'Recent tests')),
      HistoryPanel.summaryStrip(summary),
      this.list(results),
    ];
    this.root.replaceChildren(...children.filter((c): c is HTMLElement => c !== null));
    hydrateRipples(this.root);
  }

  private static summaryStrip(summary: Summary): HTMLElement | null {
    if (summary.count === 0) return null;
    const cell = (label: string, value: string): HTMLElement =>
      el('div', { class: 'summary-cell' }, el('dt', {}, label), el('dd', { class: 'tnum' }, value));

    return el(
      'dl',
      { class: 'summary-row' },
      cell(`Tests (${WINDOW_DAYS}d)`, String(summary.count)),
      cell('Avg download', `${formatSpeed(summary.avg_download_mbps)} Mbps`),
      cell('Avg upload', `${formatSpeed(summary.avg_upload_mbps)} Mbps`),
      cell('Best ping', `${formatMs(summary.min_ping_ms)} ms`),
    );
  }

  private list(results: StoredResult[]): HTMLElement {
    if (results.length === 0) {
      return el('p', { class: 'empty-state' }, 'No results yet — run a test to start the history.');
    }

    const list = el('div', { class: 'list' });
    for (const result of results) {
      const meta = [result.isp, result.server_name, result.client_ip].filter(Boolean).join(' · ');
      const row = el(
        'button',
        {
          class: 'list-row',
          type: 'button',
          title: new Date(result.created_at).toLocaleString(),
        },
        el(
          'div',
          {},
          el('div', { class: 'list-row__when' }, formatRelative(result.created_at)),
          meta ? el('div', { class: 'list-row__meta' }, meta) : null,
        ),
        el(
          'div',
          { class: 'list-row__figures tnum' },
          HistoryPanel.figure('download', formatSpeed(result.download_mbps)),
          HistoryPanel.figure('upload', formatSpeed(result.upload_mbps)),
          HistoryPanel.figure('latency', formatMs(result.ping_ms)),
        ),
      );
      row.addEventListener('click', () => this.onSelect(result));
      list.append(row);
    }
    return list;
  }

  private static figure(name: 'download' | 'upload' | 'latency', value: string): HTMLElement {
    return el('span', { class: 'list-row__figure', html: icon(name) }, el('span', {}, value));
  }
}
