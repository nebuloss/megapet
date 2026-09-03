/**
 * Material You theming.
 *
 * One seed colour produces the whole tonal system, and every
 * `--md-sys-color-*` custom property the stylesheets read is written from
 * here. Light and dark come from the same seed, so switching mode never shifts
 * hue the way two hand-picked palettes would.
 */
import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
  type Theme,
} from '@material/material-color-utilities';
import { Emitter } from '../core';
import type { Preferences } from '../core';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface SeedOption {
  readonly name: string;
  readonly hex: string;
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

const MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Neutral tones for the M3 surface roles.
 *
 * `themeFromSourceColor` still emits the 2021 scheme, which predates the
 * surface-container ramp, so these are applied on top of it.
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

function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Owns the palette. Instantiated once and injected, rather than kept in module
 * globals, so nothing can mutate the theme from the far side of the app and so
 * it can be constructed against a stub in a test.
 */
export class ThemeController {
  /** Fires with the effective dark state whenever the palette changes. */
  private readonly changes = new Emitter<boolean>();
  private readonly systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  private mode: ThemeMode = 'system';
  private seed: string = SEED_OPTIONS[0]!.hex;
  private theme: Theme;
  private readonly detachSystem: () => void;

  /**
   * @param preferences Where the visitor's choices persist.
   * @param defaultSeed From the server config; used only when the visitor has
   *        not chosen their own.
   */
  constructor(
    private readonly preferences: Preferences,
    defaultSeed?: string,
  ) {
    this.mode = preferences.getOneOf('theme.mode', MODES, 'system');

    const stored = preferences.get('theme.seed');
    const candidate = stored && HEX.test(stored) ? stored : defaultSeed;
    this.seed = candidate && HEX.test(candidate) ? candidate : SEED_OPTIONS[0]!.hex;
    this.theme = themeFromSourceColor(argbFromHex(this.seed));

    const onSystemChange = (): void => {
      if (this.mode === 'system') this.apply();
    };
    this.systemDark.addEventListener('change', onSystemChange);
    this.detachSystem = () => this.systemDark.removeEventListener('change', onSystemChange);

    this.apply();
  }

  get currentMode(): ThemeMode {
    return this.mode;
  }

  get currentSeed(): string {
    return this.seed;
  }

  get isDark(): boolean {
    return this.mode === 'dark' || (this.mode === 'system' && this.systemDark.matches);
  }

  setMode(mode: ThemeMode): void {
    this.mode = mode;
    this.preferences.set('theme.mode', mode);
    this.apply();
  }

  /** Flips between light and dark, resolving `system` to whatever it currently is. */
  toggleMode(): void {
    this.setMode(this.isDark ? 'light' : 'dark');
  }

  /** Rebuilds the whole palette from a new seed colour. */
  setSeed(hex: string): void {
    if (!HEX.test(hex)) return;
    this.seed = hex;
    this.theme = themeFromSourceColor(argbFromHex(hex));
    this.preferences.set('theme.seed', hex);
    this.apply();
  }

  onChange(listener: (dark: boolean) => void): () => void {
    return this.changes.on(listener);
  }

  destroy(): void {
    this.detachSystem();
    this.changes.clear();
  }

  private apply(): void {
    const dark = this.isDark;
    const root = document.documentElement;
    const set = (role: string, argb: number): void => {
      root.style.setProperty(`--md-sys-color-${role}`, hexFromArgb(argb));
    };

    // Base roles from the generated scheme.
    const scheme = (dark ? this.theme.schemes.dark : this.theme.schemes.light).toJSON() as Record<
      string,
      number
    >;
    for (const [role, argb] of Object.entries(scheme)) set(kebab(role), argb);

    // Then the surface ramp and the neutral-derived roles the 2021 scheme lacks.
    const { neutral, neutralVariant, primary } = this.theme.palettes;
    for (const [role, tone] of Object.entries(SURFACE_TONES[dark ? 'dark' : 'light'])) {
      set(role, neutral.tone(tone));
    }
    set('on-surface', neutral.tone(dark ? 90 : 10));
    set('on-surface-variant', neutralVariant.tone(dark ? 80 : 30));
    set('outline', neutralVariant.tone(dark ? 60 : 50));
    set('outline-variant', neutralVariant.tone(dark ? 30 : 80));
    set('inverse-surface', neutral.tone(dark ? 90 : 20));
    set('inverse-on-surface', neutral.tone(dark ? 20 : 95));
    set('inverse-primary', primary.tone(dark ? 40 : 80));

    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = hexFromArgb(neutral.tone(dark ? 12 : 94));

    this.changes.emit(dark);
  }
}
