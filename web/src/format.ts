/** Renders a throughput figure with the precision a reader can actually use. */
export function formatSpeed(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return '—';
  if (mbps >= 100) return mbps.toFixed(0);
  if (mbps >= 10) return mbps.toFixed(1);
  return mbps.toFixed(2);
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms >= 100) return ms.toFixed(0);
  if (ms >= 10) return ms.toFixed(1);
  return ms.toFixed(2);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTime.format(d);
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const RELATIVE_STEPS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.348],
  ['month', 12],
  ['year', Infinity],
];

/** "3 minutes ago", falling back to an absolute date beyond a year. */
export function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  let delta = (d.getTime() - Date.now()) / 1000;
  for (const [unit, span] of RELATIVE_STEPS) {
    if (Math.abs(delta) < span || unit === 'year') {
      return relative.format(Math.round(delta), unit);
    }
    delta /= span;
  }
  return dateTime.format(d);
}

/** A short, readable description of the browser and platform. */
export function describePlatform(): string {
  const ua = navigator.userAgent;
  const browser =
    /Firefox\/([\d.]+)/.exec(ua)?.[0] ??
    /Edg\/([\d.]+)/.exec(ua)?.[0]?.replace('Edg', 'Edge') ??
    /Chrome\/([\d.]+)/.exec(ua)?.[0] ??
    /Version\/([\d.]+).*Safari/.exec(ua)?.[0].replace(/Version\/([\d.]+).*/, 'Safari $1') ??
    'Browser';
  const os =
    /Windows NT [\d.]+/.exec(ua)?.[0] ??
    /Mac OS X [\d_]+/.exec(ua)?.[0].replace(/_/g, '.') ??
    /Android [\d.]+/.exec(ua)?.[0] ??
    /(iPhone|iPad) OS [\d_]+/.exec(ua)?.[0].replace(/_/g, '.') ??
    (/Linux/.test(ua) ? 'Linux' : '');
  return [browser.replace('/', ' '), os].filter(Boolean).join(' · ');
}
