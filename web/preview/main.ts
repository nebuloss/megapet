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
import type { Drive, GaugeAccent, SpeedVisual } from '../src/ui/visual';

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

function drive(direction: Drive): void {
  for (const visual of visuals) visual.setDrive(direction);
}

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

function resetAll(): void {
  stopSimulation();
  for (const visual of visuals) visual.reset();
  stats.reset();
}

/**
 * Replays a plausible run, including the pause the real runner takes between
 * phases so the reversal can be watched on its own.
 */
function simulate(): void {
  resetAll();
  const start = performance.now();
  const target = 940;
  const beat = lift.transitionMs / 1000;

  // Phase boundaries, in seconds from the start.
  const latencyEnd = 2.5;
  const shiftDownEnd = latencyEnd + beat;
  const downloadEnd = shiftDownEnd + 10;
  const shiftUpEnd = downloadEnd + beat;
  const uploadEnd = shiftUpEnd + 10;

  for (const visual of visuals) visual.setActive(true);

  simulation = window.setInterval(() => {
    const t = (performance.now() - start) / 1000;

    if (t < latencyEnd) {
      const rtt = 0.4 + Math.random() * 0.35;
      for (const visual of visuals) {
        visual.setAccent('secondary');
        visual.setPhase('Latency', 'latency');
        visual.setReading(rtt, 'ms');
        visual.setPosition(0);
        visual.setProgress(t / latencyEnd);
      }
      stats.setActive('ping');
      stats.set('ping', formatMs(rtt));
      return;
    }

    if (t < shiftDownEnd) {
      reverse('down', (t - latencyEnd) / beat);
      return;
    }

    if (t < downloadEnd) {
      const p = (t - shiftDownEnd) / 10;
      const value = target * (1 - Math.exp(-p * 4)) * (0.94 + Math.random() * 0.09);
      for (const visual of visuals) {
        visual.setPhase('Download', 'download');
        visual.setProgress(p);
      }
      stats.setActive('download');
      apply(value, 'primary');
      return;
    }

    if (t < shiftUpEnd) {
      reverse('up', (t - downloadEnd) / beat);
      return;
    }

    if (t < uploadEnd) {
      const p = (t - shiftUpEnd) / 10;
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
  }, 60);
}

/** The between-phase hold: reading pinned at zero while the machine changes over. */
function reverse(direction: Drive, progress: number): void {
  drive(direction);
  for (const visual of visuals) {
    visual.setAccent('secondary');
    visual.setPhase('Reversing', 'replay');
    visual.setReading(null, 'Mbps');
    visual.setPosition(0);
    visual.setProgress(progress);
  }
  stats.setActive(null);
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
let manualDrive: Drive = 'down';

slider.addEventListener('input', () => {
  stopSimulation();
  for (const visual of visuals) visual.setActive(true);
  apply(sliderToMbps(Number(slider.value)), manualDrive === 'down' ? 'primary' : 'tertiary');
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
  button('Reset', () => {
    slider.value = '0';
    manualDrive = 'down';
    resetAll();
    drive('down');
    for (const visual of visuals) visual.setPhase(null);
  }),
  button('Reverse the gear', () => {
    stopSimulation();
    manualDrive = manualDrive === 'down' ? 'up' : 'down';
    drive(manualDrive);
    for (const visual of visuals) {
      visual.setPhase(manualDrive === 'down' ? 'Download' : 'Upload',
        manualDrive === 'down' ? 'download' : 'upload');
    }
    apply(sliderToMbps(Number(slider.value)), manualDrive === 'down' ? 'primary' : 'tertiary');
  }),
  ...[10, 100, 940, 2500, 10000].map((v) =>
    button(`${v >= 1000 ? `${v / 1000} G` : `${v} M`}bps`, () => {
      stopSimulation();
      slider.value = String((Math.log10(1 + v) / Math.log10(10001)) * 1000);
      for (const visual of visuals) visual.setActive(true);
      apply(v, manualDrive === 'down' ? 'primary' : 'tertiary');
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
        'The needle and the lift are one machine. To change direction Nookies throws ' +
        'the lever in the car; the pull runs down the rope, over the guide pulley and ' +
        'onto the bellcrank, and the yoke rocks the swing gear across. Press ' +
        '“Reverse the gear” and watch the throw travel through the linkage.'),
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
drive('down');
apply(0);
