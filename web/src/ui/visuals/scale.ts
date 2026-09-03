/**
 * The shared speed scale.
 *
 * A linear scale sized for a gigabit link renders a 20 Mbps connection as an
 * invisible sliver, so both visuals map throughput logarithmically: every
 * decade gets the same amount of travel, and the readout stays legible from a
 * few megabits to ten gigabits without ever rescaling.
 *
 * Note for anything that animates: ease the **fraction**, never the Mbps. This
 * map is logarithmic, so easing the value and converting per frame makes the
 * needle leap — a first frame that eases 0 to 127 Mbps of a 940 target moves
 * the needle across 53% of the dial, and drags anything geared to it along.
 */

/** The bottom of the dial. Anything slower pins the needle against the stop. */
export const MIN_MBPS = 1;
export const MAX_MBPS = 10_000;

/** What the graduations count in, printed on the dial face. */
export const UNIT = 'Mbps';

const LOG_MIN = Math.log10(MIN_MBPS);
const LOG_SPAN = Math.log10(MAX_MBPS) - LOG_MIN;

export const TICKS: ReadonlyArray<readonly [value: number, label: string]> = [
  [1, '1'],
  [10, '10'],
  [100, '100'],
  [1000, '1k'],
  [10000, '10k'],
];

/**
 * Maps Mbps to 0..1 along the scale.
 *
 * This was `log10(1 + mbps) / log10(1 + MAX)`, where the `1 +` guarded against
 * log10(0) but shifted the whole scale: the graduations came out at 20.3, 70.3,
 * 135.3, 202.5 and 270 degrees, so the first decade got 50 degrees of dial and
 * the last got 67.5 — a third wider — with a dead 20 degree run before the "1".
 * Clamping at the bottom instead of shifting gives every decade exactly a
 * quarter of the sweep, which is the whole point of a log scale.
 */
export function toFraction(mbps: number): number {
  // NaN is the only input with no position on the dial. Everything else has
  // one, including an infinity, which belongs against the far stop and not
  // against the near one.
  if (Number.isNaN(mbps) || mbps <= MIN_MBPS) return 0;
  return Math.min(1, (Math.log10(mbps) - LOG_MIN) / LOG_SPAN);
}
