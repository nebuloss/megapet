import { describe, expect, it } from 'vitest';
import { exportFilename, toCsv, type ExportMeta } from './export';
import type { SeriesPoint } from './series';

const STARTED = new Date('2026-03-04T14:32:10.000Z');

function meta(overrides: Partial<ExportMeta> = {}): ExportMeta {
  return {
    startedAt: STARTED,
    directions: { down: true, up: true },
    server: 'this server',
    ...overrides,
  };
}

const POINTS: SeriesPoint[] = [
  { t: 0, down: 120.5, up: 12.25 },
  { t: 1000, down: 118, up: 11 },
];

function rows(csv: string): string[] {
  return csv.trimEnd().split('\n');
}

describe('CSV export', () => {
  it('starts with a header naming every column', () => {
    expect(rows(toCsv(POINTS, meta()))[0]).toBe(
      'elapsed_s,timestamp,download_mbps,upload_mbps',
    );
  });

  it('writes one row per sample', () => {
    expect(rows(toCsv(POINTS, meta()))).toHaveLength(POINTS.length + 1);
  });

  it('ends with a newline, which several parsers need to see the last row', () => {
    expect(toCsv(POINTS, meta()).endsWith('\n')).toBe(true);
  });

  /**
   * Both an offset and a wall-clock stamp: the offset is what you plot
   * against, the timestamp is what you line up against a router graph when
   * you are working out what happened at a particular time of day.
   */
  it('carries an elapsed offset and an absolute timestamp', () => {
    const [, first, second] = rows(toCsv(POINTS, meta()));
    expect(first).toContain('0.000,2026-03-04T14:32:10.000Z');
    expect(second).toContain('1.000,2026-03-04T14:32:11.000Z');
  });

  /**
   * A direction that was not measured must be blank, never zero. Zero is a
   * measurement — "the link carried nothing" — and a column of zeroes from a
   * download-only session is precisely what later gets averaged into a report.
   */
  it('leaves an unmeasured direction empty rather than zero', () => {
    const csv = toCsv(POINTS, meta({ directions: { down: true, up: false } }));
    const [, first] = rows(csv);
    expect(first!.endsWith(',')).toBe(true);
    expect(first).not.toContain('0.0000');
  });

  it('writes both columns when both were measured', () => {
    const [, first] = rows(toCsv(POINTS, meta()));
    expect(first!.split(',')[3]).toBe('12.2500');
  });

  it('produces just a header when nothing was measured', () => {
    expect(rows(toCsv([], meta()))).toHaveLength(1);
  });
});

/**
 * The columns describe the series being exported, not whatever the panel
 * happens to hold. A staged run exported through the same panel wrote every
 * row with two empty columns, because the manual session's legs had never run.
 */
describe('columns follow the data', () => {
  it('writes a direction that was measured', () => {
    const csv = toCsv(POINTS, meta({ directions: { down: true, up: false } }));
    expect(rows(csv)[1]!.split(',')[2]).not.toBe('');
  });

  it('leaves a direction that was never measured empty', () => {
    const csv = toCsv(POINTS, meta({ directions: { down: true, up: false } }));
    expect(rows(csv)[1]!.split(',')[3]).toBe('');
  });
});

describe('the exported filename', () => {
  it('says what was measured', () => {
    expect(exportFilename(meta({ directions: { down: true, up: false } }))).toContain('download');
    expect(exportFilename(meta({ directions: { down: false, up: true } }))).toContain('upload');
    expect(exportFilename(meta())).toContain('both');
  });

  it('sorts chronologically and is safe on any filesystem', () => {
    const name = exportFilename(meta());
    expect(name).toMatch(/^megapet-manual-both-2026-03-04T14-32-10Z\.csv$/);
    expect(name).not.toMatch(/[:*?"<>|]/);
  });
});
