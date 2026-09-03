/**
 * Design preview.
 *
 * Mounts the real components against a simulated test run so the mechanism can
 * be reviewed without a backend. Not part of the shipped bundle.
 */
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import '../src/styles/components.css';
import './preview.css';

import { toFraction } from '../src/ui/scale';
import { Gauge } from '../src/ui/gauge';
import { LiftScene } from '../src/ui/liftscene';
import { StatTiles } from '../src/ui/stats';
import { el } from '../src/ui/dom';
import { icon, sunIcon } from '../src/ui/icons';
import { hydrateRipples } from '../src/ui/dom';
import { SEED_OPTIONS, initTheme, isDark, setMode, setSeed } from '../src/theme';
import { formatMs, formatSpeed } from '../src/format';
import type { GaugeAccent, SpeedVisual } from '../src/ui/visual';

// A host page may have already stamped an explicit theme on the document;
// honour it instead of falling back to the OS preference.
const hostTheme = document.documentElement.dataset.theme;
initTheme('#4F6BED');
if (hostTheme === 'light' || hostTheme === 'dark') setMode(hostTheme);

const lift = new LiftScene();
const dial = new Gauge();
const stats = new StatTiles();
const visuals: SpeedVisual[] = [lift, dial];

/** Maps the linear slider onto the same log scale the visuals use. */
function sliderToMbps(position: number): number {
  if (position <= 0) return 0;
  return 10 ** ((position / 1000) * Math.log10(10001)) - 1;
}

let simulation: number | undefined;

function apply(value: number, accent: GaugeAccent = 'primary'): void {
  for (const visual of visuals) {
    visual.setAccent(accent);
    visual.setReading(null, 'Mbps');
    visual.setPosition(value);
    visual.setProgress(toFraction(value));
  }
  readout.textContent = `${formatSpeed(value)} Mbps · scale position ${(toFraction(value) * 100).toFixed(0)}%`;
  stats.set('download', formatSpeed(value));
  stats.set('upload', formatSpeed(value * 0.94));
  stats.set('ping', formatMs(0.4 + 40 / (value + 4)));
  stats.set('jitter', formatMs(0.08 + 6 / (value + 8)));
}

function stopSimulation(): void {
  if (simulation) window.clearInterval(simulation);
  simulation = undefined;
  for (const visual of visuals) visual.setActive(false);
}

/** Replays a plausible latency → download → upload run. */
function simulate(): void {
  stopSimulation();
  const start = performance.now();
  const target = 940;
  for (const visual of visuals) visual.setActive(true);

  simulation = window.setInterval(() => {
    const t = (performance.now() - start) / 1000;

    if (t < 2.5) {
      const rtt = 0.4 + Math.random() * 0.35;
      for (const visual of visuals) {
        visual.setAccent('secondary');
        visual.setPhase('Latency', 'latency');
        visual.setReading(rtt, 'ms');
        visual.setPosition(0);
        visual.setProgress(t / 2.5);
      }
      stats.setActive('ping');
      stats.set('ping', formatMs(rtt));
      return;
    }

    if (t < 12.5) {
      const p = (t - 2.5) / 10;
      const value = target * (1 - Math.exp(-p * 4)) * (0.94 + Math.random() * 0.09);
      for (const visual of visuals) {
        visual.setPhase('Download', 'download');
        visual.setProgress(p);
      }
      stats.setActive('download');
      apply(value, 'primary');
      return;
    }

    if (t < 22.5) {
      const p = (t - 12.5) / 10;
      const value = target * 0.94 * (1 - Math.exp(-p * 4)) * (0.94 + Math.random() * 0.09);
      for (const visual of visuals) {
        visual.setPhase('Upload', 'upload');
        visual.setProgress(p);
      }
      stats.setActive('upload');
      apply(value, 'tertiary');
      return;
    }

    for (const visual of visuals) visual.setPhase('Complete', 'check');
    stats.setActive(null);
    stopSimulation();
  }, 80);
}

// ------------------------------------------------------------------ chrome --

const readout = el('p', { class: 'preview__readout tnum' }, '0.00 Mbps');

const slider = el('input', {
  type: 'range',
  min: '0',
  max: '1000',
  value: '0',
  class: 'preview__slider',
  'aria-label': 'Simulated speed',
}) as HTMLInputElement;
slider.addEventListener('input', () => {
  stopSimulation();
  for (const visual of visuals) visual.setActive(true);
  apply(sliderToMbps(Number(slider.value)));
});

function button(label: string, onClick: () => void, cls = 'btn btn--tonal'): HTMLElement {
  const node = el('button', { class: cls, type: 'button' }, label);
  node.addEventListener('click', onClick);
  return node;
}

const presets = el(
  'div',
  { class: 'preview__row' },
  button('Simulate a full run', simulate, 'btn'),
  button('Idle', () => {
    stopSimulation();
    slider.value = '0';
    for (const visual of visuals) visual.setPhase(null);
    apply(0);
  }),
  ...[10, 100, 940, 2500, 10000].map((v) =>
    button(`${v >= 1000 ? `${v / 1000} G` : `${v} M`}bps`, () => {
      stopSimulation();
      slider.value = String((Math.log10(1 + v) / Math.log10(10001)) * 1000);
      for (const visual of visuals) visual.setActive(true);
      apply(v);
    }),
  ),
);

const themeRow = el('div', { class: 'preview__row' });
const themeToggle = el('button', { class: 'icon-button', type: 'button', title: 'Toggle light and dark' });
const paintToggle = (): void => {
  themeToggle.innerHTML = isDark() ? sunIcon() : icon('moon');
};
paintToggle();
themeToggle.addEventListener('click', () => {
  setMode(isDark() ? 'light' : 'dark');
  paintToggle();
});
themeRow.append(themeToggle);
for (const option of SEED_OPTIONS) {
  const swatch = el('button', {
    class: 'swatch preview__swatch',
    type: 'button',
    title: option.name,
    'aria-label': option.name,
    style: `background:${option.hex}`,
    html: icon('check'),
  });
  swatch.addEventListener('click', () => {
    for (const s of themeRow.querySelectorAll('.swatch')) s.setAttribute('aria-checked', 'false');
    swatch.setAttribute('aria-checked', 'true');
    setSeed(option.hex);
  });
  themeRow.append(swatch);
}

const root = document.getElementById('preview')!;
root.append(
  el(
    'div',
    { class: 'preview' },
    el('header', { class: 'preview__head' },
      el('h1', {}, 'Nookies lift'),
      el('p', {},
        'The needle and the lift are one machine. The needle sits on the hub gear, ' +
        'the hub drives the idler, the idler drives the drum, and the drum winds the ' +
        'cable that lifts Nookies. Drag the slider and watch the whole chain move at once.'),
    ),
    themeRow,
    el('div', { class: 'preview__stage' },
      el('section', { class: 'hero preview__hero' },
        el('div', { class: 'hero__visual' }, lift.root),
      ),
      el('section', { class: 'hero preview__hero' },
        el('div', { class: 'hero__visual' }, dial.root),
      ),
    ),
    slider,
    readout,
    presets,
    el('h2', { class: 'preview__sub' }, 'Stat tiles'),
    stats.root,
  ),
);

hydrateRipples(root);
apply(0);
