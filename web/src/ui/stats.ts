import { el } from './dom';
import { icon, type IconName } from './icons';

export type StatKey = 'download' | 'upload' | 'ping' | 'jitter';

interface Tile {
  key: StatKey;
  label: string;
  unit: string;
  icon: IconName;
}

const TILES: readonly Tile[] = [
  { key: 'download', label: 'Download', unit: 'Mbps', icon: 'download' },
  { key: 'upload', label: 'Upload', unit: 'Mbps', icon: 'upload' },
  { key: 'ping', label: 'Ping', unit: 'ms', icon: 'latency' },
  { key: 'jitter', label: 'Jitter', unit: 'ms', icon: 'jitter' },
];

/** The four headline figures, one card each. */
export class StatTiles {
  readonly root: HTMLElement;
  private readonly values = new Map<StatKey, HTMLElement>();

  constructor() {
    this.root = el('div', { class: 'stat-grid' });
    for (const tile of TILES) {
      const value = el('div', { class: 'stat__value tnum' }, '—');
      this.values.set(tile.key, value);
      this.root.append(
        el(
          'div',
          { class: 'stat', 'data-key': tile.key, 'data-active': 'false' },
          el('div', { class: 'stat__head', html: icon(tile.icon) }, el('span', {}, tile.label)),
          value,
          el('div', { class: 'stat__unit' }, tile.unit),
        ),
      );
    }
  }

  set(key: StatKey, value: string): void {
    const node = this.values.get(key);
    if (node) node.textContent = value;
  }

  /** Highlights the tile the current phase is filling in. */
  setActive(key: StatKey | null): void {
    for (const tile of this.root.querySelectorAll<HTMLElement>('.stat')) {
      tile.dataset.active = String(tile.dataset.key === key);
    }
  }

  reset(): void {
    for (const node of this.values.values()) node.textContent = '—';
    this.setActive(null);
  }
}
