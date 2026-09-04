import { SWEEP_MIN_MS, SWEEP_MS } from './tempo';
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

/** How fast the needle chases a reading: the time constant of its easing. */
export const EASE_TAU = 110;

/**
 * The needle's speed limit: how long it takes to cross the whole dial.
 *
 * An exponential ease alone has no speed, only a time constant, so how fast
 * the needle moves depends on how far it has to go. A ten-gigabit reading
 * slams it across the dial in a third of a second while a slow link ambles
 * across a corner of it — the same animation at two different speeds, decided
 * by the link rather than by the design. The limit only bites on big jumps;
 * near the target the exponential is already slower than this.
 */


/** How long the needle takes to cover `distance` of the dial, 0..1. */
export function sweepMs(distance: number): number {
  return Math.max(SWEEP_MIN_MS, Math.round(Math.abs(distance) * SWEEP_MS));
}

/** The bottom of the dial. Anything slower pins the needle against the stop. */
export { SWEEP_MS } from './tempo';

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
  [1000, '1000'],
  [10000, '10000'],
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

/**
 * The scale read backwards: what reading sits at this position on the dial.
 *
 * So a readout can be derived from where the pointer is rather than eased
 * alongside it. Two values easing separately towards the same reading do not
 * agree on the way — the number ran most of the way up while the pointer was
 * still leaving the stop — and the only way to be sure they agree is for there
 * to be one of them.
 */
export function fromFraction(position: number): number {
  if (position <= 0) return 0;
  return 10 ** (position * LOG_SPAN + LOG_MIN);
}
