/**
 * Inline stroke icons.
 *
 * Drawn here rather than pulled from an icon font: two dozen glyphs are cheaper
 * as markup than as a webfont request, and an internal tool should not depend
 * on a CDN being reachable.
 */
const PATHS = {
  download: 'M12 4v12m0 0l-4.5-4.5M12 16l4.5-4.5M5 20h14',
  upload: 'M12 20V8m0 0L7.5 12.5M12 8l4.5 4.5M5 4h14',
  latency: 'M12 21a9 9 0 1 1 9-9M12 7.5V12l3 1.75M17 17l2.5 2.5M19.5 17L17 19.5',
  jitter: 'M2 12h3.5L8 5l4 14 2.5-7H22',
  speed: 'M4.5 18.5a9 9 0 1 1 15 0M12 18.5l4.2-6.2',
  sun: 'M12 5V3M12 21v-2M5 12H3M21 12h-2M6.34 6.34L4.93 4.93M19.07 19.07l-1.41-1.41M17.66 6.34l1.41-1.41M4.93 19.07l1.41-1.41',
  sunCircle: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  moon: 'M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5a8.6 8.6 0 1 0 11.3 11.3z',
  contrast: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 0v18',
  palette:
    'M12 3a9 9 0 0 0 0 18 1.6 1.6 0 0 0 1.6-1.6c0-.42-.16-.8-.42-1.08a1.6 1.6 0 0 1 1.18-2.68h1.9A4.74 4.74 0 0 0 21 10.9C21 6.53 16.97 3 12 3z',
  server: 'M4 5h16v5H4zM4 14h16v5H4zM7.5 7.5h.01M7.5 16.5h.01',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 4.5V9h4.5M12 7.5V12l3.2 1.9',
  share: 'M9 13.5l6-3M9 10.5l6 3M18 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  link: 'M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 1 0-5.66-5.66L11.5 6.9M14 10a4 4 0 0 0-5.66 0L5.5 12.83a4 4 0 1 0 5.66 5.66L12.5 17.1',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5L13 16M14 14l2-2 4 4M15 9h.01',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  replay: 'M20.5 12a8.5 8.5 0 1 1-2.6-6.1M21 4.5V9h-4.5',
  stop: 'M7 7h10v10H7z',
  chevron: 'M9 5.5l6.5 6.5L9 18.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.6h.01',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 9.5h17M3.5 14.5h17M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18',
} as const;

export type IconName = keyof typeof PATHS;

/** Returns the SVG markup for an icon, sized by the surrounding CSS. */
export function icon(name: IconName, extra = ''): string {
  return (
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>` +
    `<path d="${PATHS[name]}"/></svg>`
  );
}

/** The light-mode glyph needs two subpaths, so it gets its own builder. */
export function sunIcon(): string {
  return (
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${PATHS.sunCircle}"/><path d="${PATHS.sun}"/></svg>`
  );
}
