import { formatMs, formatRelative, formatSpeed } from '../format';
import type { StoredResult, Summary } from '../types';
import { el } from './dom';
import { icon } from './icons';

/** The rolling averages strip shown above the history list. */
export function renderSummary(summary: Summary, days: number): HTMLElement | null {
  if (summary.count === 0) return null;

  const cell = (label: string, value: string): HTMLElement =>
    el('div', { class: 'summary-cell' }, el('dt', {}, label), el('dd', { class: 'tnum' }, value));

  return el(
    'dl',
    { class: 'summary-row' },
    cell(`Tests (${days}d)`, String(summary.count)),
    cell('Avg download', `${formatSpeed(summary.avg_download_mbps)} Mbps`),
    cell('Avg upload', `${formatSpeed(summary.avg_upload_mbps)} Mbps`),
    cell('Best ping', `${formatMs(summary.min_ping_ms)} ms`),
  );
}

export function renderHistory(
  results: StoredResult[],
  onSelect: (result: StoredResult) => void,
): HTMLElement {
  if (results.length === 0) {
    return el('p', { class: 'empty-state' }, 'No results yet — run a test to start the history.');
  }

  const list = el('div', { class: 'list' });
  for (const result of results) {
    const meta = [result.isp, result.server_name, result.client_ip].filter(Boolean).join(' · ');

    const row = el(
      'button',
      { class: 'list-row', type: 'button', title: new Date(result.created_at).toLocaleString() },
      el(
        'div',
        {},
        el('div', { class: 'list-row__when' }, formatRelative(result.created_at)),
        meta ? el('div', { class: 'list-row__meta' }, meta) : null,
      ),
      el(
        'div',
        { class: 'list-row__figures tnum' },
        figure('download', `${formatSpeed(result.download_mbps)}`),
        figure('upload', `${formatSpeed(result.upload_mbps)}`),
        figure('latency', `${formatMs(result.ping_ms)}`),
      ),
    );
    row.addEventListener('click', () => onSelect(result));
    list.append(row);
  }
  return list;
}

function figure(name: 'download' | 'upload' | 'latency', value: string): HTMLElement {
  return el('span', { class: 'list-row__figure', html: icon(name) }, el('span', {}, value));
}
