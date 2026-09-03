import { describe, expect, it } from 'vitest';
import { approach } from '../../primitives/anim';
import { toFraction } from '../scale';
import { carriageTop, type CarriageInput } from './carriage';
import { CAR, CAR_BOTTOM, EASE_TAU, HOME_MS, SHIFT_MS, TRAVEL } from './layout';

const FRAME_MS = 16;

/**
 * The needle eases with a time constant, so in one frame it can close at most
 * `1 - e^(-dt/tau)` of the gap to its target — about 13.5% of full scale. The
 * car is geared straight to it, so that is also the most it may move. Anything
 * beyond this is a teleport, which is the bug this file exists to catch.
 */
const MAX_STEP = (1 - Math.exp(-FRAME_MS / EASE_TAU)) * TRAVEL;

interface Machine {
  top: number;
  /** Needle position, 0..1 — eased in fraction space, as the visuals do. */
  shown: number;
  lastFraction: number;
  driveSign: number;
  shiftT: number;
  homeT: number;
  homeFrom: number;
}

function machine(): Machine {
  return {
    top: CAR.top,
    shown: 0,
    lastFraction: 0,
    driveSign: -1,
    shiftT: 1,
    homeT: 1,
    homeFrom: CAR.top,
  };
}

/** One frame of the same sequence `LiftVisual` runs: ease, advance, place. */
function frame(m: Machine, target: number): number {
  m.shown = approach(m.shown, toFraction(target), FRAME_MS, EASE_TAU);
  if (m.shiftT < 1) m.shiftT = Math.min(1, m.shiftT + FRAME_MS / SHIFT_MS);
  if (m.homeT < 1) m.homeT = Math.min(1, m.homeT + FRAME_MS / HOME_MS);

  const fraction = m.shown;
  const input: CarriageInput = {
    top: m.top,
    fraction,
    lastFraction: m.lastFraction,
    driveSign: m.driveSign,
    held: m.shiftT < 1,
    homing: m.homeT,
    homeFrom: m.homeFrom,
  };
  const next = carriageTop(input);
  const moved = Math.abs(next - m.top);
  m.top = next;
  m.lastFraction = fraction;
  return moved;
}

/** Run `ms` worth of frames at one target, returning the largest single step. */
function hold(m: Machine, target: number, ms: number): number {
  let worst = 0;
  for (let t = 0; t < ms; t += FRAME_MS) worst = Math.max(worst, frame(m, target));
  return worst;
}

/** What the app does between phases: cross the belt, with the brake on. */
function reverse(m: Machine, drive: 'up' | 'down'): void {
  m.driveSign = drive === 'down' ? 1 : -1;
  m.shiftT = 0;
}

/** What `reset()` does: aim at zero and drive the car home from where it is. */
function reset(m: Machine): void {
  m.driveSign = -1;
  m.homeFrom = m.top;
  m.homeT = 0;
}

/** Latency, then download, then upload — the shape of one test run. */
function run(m: Machine, downloadMbps: number, uploadMbps: number): number {
  let worst = 0;
  reset(m);
  worst = Math.max(worst, hold(m, 0, 1200)); // latency
  reverse(m, 'down');
  worst = Math.max(worst, hold(m, 0, SHIFT_MS + 250));
  worst = Math.max(worst, hold(m, downloadMbps, 8000));
  reverse(m, 'up');
  worst = Math.max(worst, hold(m, 0, SHIFT_MS + 250));
  worst = Math.max(worst, hold(m, uploadMbps, 8000));
  return worst;
}

describe('carriageTop', () => {
  it('never jumps across a whole run', () => {
    const m = machine();
    expect(run(m, 940, 780)).toBeLessThanOrEqual(MAX_STEP);
  });

  it('never jumps when a second run resets a car left down the shaft', () => {
    const m = machine();
    run(m, 940, 780);
    // Leave it stopped mid-shaft with the needle still reading, the state a
    // cancelled test ends in — the case that used to teleport it to the top.
    m.top = CAR_BOTTOM;
    m.shown = toFraction(940);
    m.lastFraction = toFraction(940);
    expect(run(m, 620, 450)).toBeLessThanOrEqual(MAX_STEP);
  });

  it('lands exactly on the top floor when homing finishes', () => {
    const m = machine();
    m.top = CAR_BOTTOM;
    reset(m);
    hold(m, 0, HOME_MS + FRAME_MS);
    expect(m.homeT).toBe(1);
    expect(m.top).toBeCloseTo(CAR.top, 3);
  });

  it('holds the car still while the belt is being crossed', () => {
    const m = machine();
    m.top = (CAR.top + CAR_BOTTOM) / 2;
    m.shown = toFraction(940);
    m.lastFraction = toFraction(940);
    reverse(m, 'up');
    const before = m.top;
    hold(m, 0, SHIFT_MS - FRAME_MS);
    expect(m.top).toBe(before);
  });

  it('stays within the shaft', () => {
    const m = machine();
    m.homeT = 1;
    m.driveSign = 1;
    for (let i = 0; i < 400; i += 1) frame(m, 10_000);
    expect(m.top).toBeLessThanOrEqual(CAR_BOTTOM);
    expect(m.top).toBeGreaterThanOrEqual(CAR.top);
  });
});
