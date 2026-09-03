import { Component } from '../../core';
import { el } from '../primitives/dom';
import { icon, type IconName } from '../primitives/icons';

/** The four headline figures a run produces. */
export type StatKey = 'download' | 'upload' | 'ping' | 'jitter';

interface TileSpec {
  readonly key: StatKey;
  readonly label: string;
  readonly unit: string;
  readonly icon: IconName;
}

const TILES: readonly TileSpec[] = [
  { key: 'download', label: 'Download', unit: 'Mbps', icon: 'download' },
  { key: 'upload', label: 'Upload', unit: 'Mbps', icon: 'upload' },
  { key: 'ping', label: 'Ping', unit: 'ms', icon: 'latency' },
  { key: 'jitter', label: 'Jitter', unit: 'ms', icon: 'jitter' },
];

/**
 * The four stat cards.
 *
 * Holds a reference to each value element so updating a figure is a text
 * assignment rather than a re-render — this is written to sixty times a second
 * while a test runs.
 */
export class StatTiles extends Component {
  private readonly values = new Map<StatKey, HTMLElement>();
  private readonly units = new Map<StatKey, HTMLElement>();
  private readonly tiles = new Map<StatKey, HTMLElement>();

  constructor() {
    super(el('div', { class: 'stat-grid' }));

    for (const spec of TILES) {
      const value = el('div', { class: 'stat__value tnum' }, '—');
      const unit = el('div', { class: 'stat__unit' }, spec.unit);
      const tile = el(
        'div',
        { class: 'stat', 'data-key': spec.key, 'data-active': 'false' },
        el('div', { class: 'stat__head', html: icon(spec.icon) }, el('span', {}, spec.label)),
        value,
        unit,
      );
      this.values.set(spec.key, value);
      this.units.set(spec.key, unit);
      this.tiles.set(spec.key, tile);
      this.root.append(tile);
    }
  }

  /** `unit` follows the figure: a throughput tile changes unit as it grows. */
  set(key: StatKey, value: string, unit?: string): void {
    const node = this.values.get(key);
    if (node) node.textContent = value;
    if (unit === undefined) return;
    const label = this.units.get(key);
    if (label && label.textContent !== unit) label.textContent = unit;
  }

  /** Highlights the tile the current phase is filling in. */
  setActive(key: StatKey | null): void {
    for (const [tileKey, tile] of this.tiles) {
      tile.dataset.active = String(tileKey === key);
    }
  }

  reset(): void {
    // Units go back to their defaults too: a run that ended in Gbps must not
    // leave the tile labelled Gbps above a dash.
    for (const spec of TILES) this.set(spec.key, '—', spec.unit);
    this.setActive(null);
  }
}
