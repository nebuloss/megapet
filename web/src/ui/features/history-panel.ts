import type { ApiClient } from '../../api';
import { Component } from '../../core';
import type { StoredResult, Summary } from '../../domain/types';
import { el, hydrateRipples } from '../primitives/dom';
import { formatRelative, formatSpeed } from '../primitives/format';
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

  /**
   * Two halves, each named.
   *
   * The panel used to carry one heading over both, so the aggregate figures
   * and the individual runs ran together — a reader had no way to tell that
   * "132 Mbps" was an average of a month and the row beneath it was a single
   * test. Naming each says which is which, and the rule between them marks
   * where the scrolling list begins.
   */
  private render(results: StoredResult[], summary: Summary): void {
    const strip = HistoryPanel.summaryStrip(summary);
    const children: (HTMLElement | null)[] = [
      strip
        ? el(
            'div',
            { class: 'section__head' },
            el('h2', { class: 'section__title' }, `Last ${WINDOW_DAYS} days`),
          )
        : null,
      strip,
      el(
        'div',
        { class: 'section__head section__head--sub' },
        el('h3', { class: 'section__subtitle' }, 'Recent tests'),
        results.length > 0
          ? el('span', { class: 'section__count' }, `${results.length} shown`)
          : null,
      ),
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
      // Just "Tests": the window is named by the heading above this strip.
      cell('Tests', String(summary.count)),
      cell('Avg download', `${formatSpeed(summary.avg_download_mbps)} Mbps`),
      cell('Avg upload', `${formatSpeed(summary.avg_upload_mbps)} Mbps`),
      cell('Best download', `${formatSpeed(summary.max_download_mbps)} Mbps`),
    );
  }

  private list(results: StoredResult[]): HTMLElement {
    if (results.length === 0) {
      return el('p', { class: 'empty-state' }, 'No results yet — run a test to start the history.');
    }

    // Scrolls within itself so the page stays one screen tall however long the
    // history grows. The rows are a list you dip into, not something you read
    // to the end, so pushing the rest of the page down to show all of them is
    // the wrong trade.
    const list = el('div', { class: 'list list--scroll', tabindex: '0' });
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
