/**
 * Exporting a monitor session for analysis elsewhere.
 *
 * CSV, because the point of exporting is to open the data in something else —
 * a spreadsheet, pandas, R, gnuplot — and CSV is the only format all of those
 * read without being told anything. JSON would preserve more structure that
 * nothing on the receiving end wants.
 *
 * One row per sample, with both an elapsed offset and an absolute timestamp:
 * the offset is what you plot against, the timestamp is what you correlate
 * with a router graph or a log when you are trying to find out what happened
 * at 14:32.
 */
import type { SeriesPoint } from './series';
import type { Directions } from './monitor';

export interface ExportMeta {
  /** Wall-clock time the session began. */
  readonly startedAt: Date;
  readonly directions: Directions;
  /** Where the session was measured against, for the filename and a column. */
  readonly server: string;
}

const COLUMNS = ['elapsed_s', 'timestamp', 'download_mbps', 'upload_mbps'] as const;

/**
 * Renders the session as CSV.
 *
 * A direction that was never switched on during the session is written empty
 * rather than as a column of zeroes, which is exactly the sort of thing that
 * later gets averaged into a report. A direction that was switched on and
 * later off does export zeroes for the stretch it was off, because that is
 * what the graph showed and an export should match what you saw.
 *
 * Note that once a long session has compacted its history, a row is the mean
 * of the samples it replaced rather than a single instant. The timestamps stay
 * truthful about when each row begins, so the spacing between rows tells you
 * the resolution.
 */
export function toCsv(points: readonly SeriesPoint[], meta: ExportMeta): string {
  const lines: string[] = [COLUMNS.join(',')];
  for (const point of points) {
    const at = new Date(meta.startedAt.getTime() + point.t);
    lines.push(
      [
        (point.t / 1000).toFixed(3),
        at.toISOString(),
        meta.directions.down ? point.down.toFixed(4) : '',
        meta.directions.up ? point.up.toFixed(4) : '',
      ].join(','),
    );
  }
  // A trailing newline: POSIX text, and several parsers drop the last row
  // without one.
  return `${lines.join('\n')}\n`;
}

/** A filename that sorts chronologically and says what it holds. */
export function exportFilename(meta: ExportMeta): string {
  const stamp = meta.startedAt
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/-\d{3}Z$/, 'Z');
  const what = meta.directions.down && meta.directions.up
    ? 'both'
    : meta.directions.down
      ? 'download'
      : 'upload';
  return `megapet-manual-${what}-${stamp}.csv`;
}

/**
 * Hands the CSV to the browser as a download.
 *
 * The object URL is revoked on the next task rather than immediately: Safari
 * has historically cancelled the download if the URL is released in the same
 * tick as the click.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
