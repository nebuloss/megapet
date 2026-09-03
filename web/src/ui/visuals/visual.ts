import type { View } from '../../core';
import type { IconName } from '../primitives/icons';

export type GaugeAccent = 'primary' | 'tertiary' | 'secondary';

/** Which way the lift travels as the reading rises. */
export type Drive = 'down' | 'up';

/**
 * The contract the hero visual satisfies, so the dial and the lift scene are
 * interchangeable without the rest of the app knowing which one is mounted.
 *
 * Position and readout are separate on purpose: the latency phase shows
 * milliseconds, which have no meaningful place on a throughput scale.
 */
export interface SpeedVisual extends View {
  /**
   * How long this visual needs to change direction. The runner holds between
   * phases for exactly this long, so a visual with a drive train to show gets
   * the stage to itself and a plain dial barely pauses at all.
   */
  readonly transitionMs: number;
  /** Positions the dial or lift on the shared log scale, in Mbps. */
  setPosition(mbps: number): void;
  /**
   * Overrides the number in the readout. Pass `null` to let it follow the
   * position again, which is what both throughput phases want.
   */
  setReading(value: number | null, unit: string): void;
  /**
   * Selects the direction of travel for the phase about to start. The lift
   * shifts its reversing gear and re-anchors where the car currently is, so
   * changing direction never teleports it.
   */
  setDrive(direction: Drive): void;
  /**
   * Ends the current leg of travel. The lift finishes its run into the floor
   * it was heading for rather than stopping wherever the reading left it, so
   * a download arrives at the bottom and an upload at the top.
   */
  land(): void;
  /** Returns to the resting state before a new run. */
  reset(): void;
  /** 0..1 elapsed fraction of the current phase. */
  setProgress(fraction: number): void;
  setAccent(accent: GaugeAccent): void;
  setPhase(label: string | null, icon?: IconName): void;
  /** Tells the visual whether a test is currently under way. */
  setActive(active: boolean): void;
}

/** Formats a readout number according to its unit. */
export function readoutText(value: number, unit: string): string {
  if (!Number.isFinite(value) || value <= 0) return unit === 'ms' ? '—' : '0.00';
  if (unit === 'ms') return value >= 100 ? value.toFixed(0) : value.toFixed(1);
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
