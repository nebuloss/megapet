/**
 * Material You theming.
 *
 * A single seed colour produces the whole tonal system; every `--md-sys-color-*`
 * custom property used by the stylesheets is written here at runtime. Light and
 * dark are generated from the same seed, so switching mode never desaturates or
 * shifts hue the way two hand-picked palettes would.
 */
import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
  type Theme,
} from '@material/material-color-utilities';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface SeedOption {
  name: string;
  hex: string;
}

/** Seeds offered in the palette menu. Any hex works; these are just presets. */
export const SEED_OPTIONS: readonly SeedOption[] = [
  { name: 'Indigo', hex: '#4F6BED' },
  { name: 'Teal', hex: '#00796B' },
  { name: 'Violet', hex: '#7C4DFF' },
  { name: 'Rose', hex: '#C2185B' },
  { name: 'Amber', hex: '#F57C00' },
  { name: 'Forest', hex: '#2E7D32' },
  { name: 'Cyan', hex: '#0097A7' },
  { name: 'Crimson', hex: '#D32F2F' },
  { name: 'Slate', hex: '#546E7A' },
  { name: 'Lime', hex: '#7CB342' },
];

const MODE_KEY = 'speedtest.theme.mode';
const SEED_KEY = 'speedtest.theme.seed';

/**
 * Neutral tones for the M3 surface roles. `themeFromSourceColor` still emits the
 * 2021 scheme, which predates the surface-container ramp, so these are applied
 * on top of it.
 */
const SURFACE_TONES = {
  light: {
    surface: 98,
    'surface-dim': 87,
    'surface-bright': 98,
    'surface-container-lowest': 100,
    'surface-container-low': 96,
    'surface-container': 94,
    'surface-container-high': 92,
    'surface-container-highest': 90,
  },
  dark: {
    surface: 6,
    'surface-dim': 6,
    'surface-bright': 24,
    'surface-container-lowest': 4,
    'surface-container-low': 10,
    'surface-container': 12,
    'surface-container-high': 17,
    'surface-container-highest': 22,
  },
} as const;

let currentMode: ThemeMode = 'system';
let currentSeed = SEED_OPTIONS[0]!.hex;
let cachedTheme: Theme | null = null;

const listeners = new Set<(dark: boolean) => void>();
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private browsing or blocked storage: fall back to the defaults.
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not fatal — the choice simply will not persist */
  }
}

function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function isDark(): boolean {
  return currentMode === 'dark' || (currentMode === 'system' && systemDark.matches);
}

export function getMode(): ThemeMode {
  return currentMode;
}

export function getSeed(): string {
  return currentSeed;
}

function apply(): void {
  if (!cachedTheme) return;
  const dark = isDark();
  const scheme = dark ? cachedTheme.schemes.dark : cachedTheme.schemes.light;
  const root = document.documentElement;

  // Base roles from the generated scheme.
  const roles = scheme.toJSON() as Record<string, number>;
  for (const [role, argb] of Object.entries(roles)) {
    root.style.setProperty(`--md-sys-color-${kebab(role)}`, hexFromArgb(argb));
  }

  // Surface ramp and the neutral-derived roles the 2021 scheme lacks.
  const { neutral, neutralVariant, primary } = cachedTheme.palettes;
  for (const [role, tone] of Object.entries(SURFACE_TONES[dark ? 'dark' : 'light'])) {
    root.style.setProperty(`--md-sys-color-${role}`, hexFromArgb(neutral.tone(tone)));
  }
  const derived: Record<string, number> = {
    'on-surface': neutral.tone(dark ? 90 : 10),
    'on-surface-variant': neutralVariant.tone(dark ? 80 : 30),
    outline: neutralVariant.tone(dark ? 60 : 50),
    'outline-variant': neutralVariant.tone(dark ? 30 : 80),
    'inverse-surface': neutral.tone(dark ? 90 : 20),
    'inverse-on-surface': neutral.tone(dark ? 20 : 95),
    'inverse-primary': primary.tone(dark ? 40 : 80),
  };
  for (const [role, argb] of Object.entries(derived)) {
    root.style.setProperty(`--md-sys-color-${role}`, hexFromArgb(argb));
  }

  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = hexFromArgb(neutral.tone(dark ? 12 : 94));
  }

  for (const listener of listeners) listener(dark);
}

/** Rebuilds the palette from a new seed colour. */
export function setSeed(hex: string): void {
  if (!isHex(hex)) return;
  currentSeed = hex;
  cachedTheme = themeFromSourceColor(argbFromHex(hex));
  writeStorage(SEED_KEY, hex);
  apply();
}

export function setMode(mode: ThemeMode): void {
  currentMode = mode;
  writeStorage(MODE_KEY, mode);
  apply();
}

/** Registers a callback fired whenever the effective light/dark state changes. */
export function onThemeChange(fn: (dark: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Initialises theming. `defaultSeed` comes from the server config and is used
 * only when the visitor has not chosen their own.
 */
export function initTheme(defaultSeed?: string): void {
  const storedMode = readStorage(MODE_KEY);
  if (storedMode === 'light' || storedMode === 'dark' || storedMode === 'system') {
    currentMode = storedMode;
  }
  const storedSeed = readStorage(SEED_KEY);
  const seed = storedSeed && isHex(storedSeed) ? storedSeed : defaultSeed;
  currentSeed = seed && isHex(seed) ? seed : SEED_OPTIONS[0]!.hex;

  cachedTheme = themeFromSourceColor(argbFromHex(currentSeed));
  systemDark.addEventListener('change', () => {
    if (currentMode === 'system') apply();
  });
  apply();
}
