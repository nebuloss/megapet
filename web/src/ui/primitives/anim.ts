/** Easing and stage timing for hand-driven animation. */
import { clamp } from '../../mech';

/** Progress through one stage of a longer sequence, given overall progress. */
export function stage(t: number, [from, to]: readonly [number, number]): number {
  return clamp((t - from) / (to - from), 0, 1);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Overshoots slightly, so a part lands with a mechanical snap. Kept gentle on
 * purpose: a big overshoot on a geared part drives teeth into each other.
 */
export function easeOutBack(t: number, overshoot = 1.4): number {
  return 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
}

/**
 * Caps how far a value may travel in one frame.
 *
 * Turns "arrive in a fixed time" into "move at a fixed speed": a longer
 * journey takes proportionally longer rather than being covered faster.
 * `fullMs` is how long the whole range, 0 to 1, is allowed to take.
 */
export function limitStep(step: number, dt: number, fullMs: number): number {
  const most = dt / fullMs;
  return clamp(step, -most, most);
}

/**
 * Frame-rate independent exponential approach. `tau` is the time constant in
 * milliseconds: the motion looks the same at 60 Hz and 144 Hz.
 */
export function approach(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}
