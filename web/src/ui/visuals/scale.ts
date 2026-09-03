/**
 * The shared speed scale.
 *
 * A linear scale sized for a gigabit link renders a 20 Mbps connection as an
 * invisible sliver, so both visuals map throughput logarithmically: every
 * decade gets the same amount of travel, and the readout stays legible from a
 * few megabits to ten gigabits without ever rescaling.
 */
export const MAX_MBPS = 10_000;

const LOG_MAX = Math.log10(1 + MAX_MBPS);

export const TICKS: ReadonlyArray<readonly [value: number, label: string]> = [
  [1, '1'],
  [10, '10'],
  [100, '100'],
  [1000, '1k'],
  [10000, '10k'],
];

/** Maps Mbps to 0..1 along the scale. */
export function toFraction(mbps: number): number {
  if (!Number.isFinite(mbps) || mbps <= 0) return 0;
  return Math.min(1, Math.log10(1 + mbps) / LOG_MAX);
}
