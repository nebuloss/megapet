import { describe, expect, it } from 'vitest';
import { approach } from '../../primitives/anim';
import { toFraction } from '../scale';
import { carriageTop, type CarriageInput } from './carriage';
import { CAR, CAR_BOTTOM, EASE_TAU, HOME_MS, LAND_MS, SHIFT_MS, TRAVEL } from './layout';

const FRAME_MS = 16;

/**
 * The needle eases with a time constant, so in one frame it can close at most
 * `1 - e^(-dt/tau)` of the gap to its target — about 13.5% of full scale. The
 * car is geared straight to it, so that is also the most it may move. Anything
 * beyond this is a teleport, which is the bug this file exists to catch.
 */
const MAX_STEP = (1 - Math.exp(-FRAME_MS / EASE_TAU)) * TRAVEL;

/**
 * How close to a floor counts as landed.
 *
 * Not exactly on it: the belt stays connected, so once the landing hands back
 * to the drive the last of the needle's decay nudges the car a fraction of a
 * unit. That is the mechanism behaving correctly, and it is about two
 * thousandths of a pixel on a shaft that renders under a pixel per unit — the
 * brake sets immediately afterwards anyway.
 */
const ON_THE_FLOOR = 0.01;

interface Machine {
  top: number;
  /** Needle position, 0..1 — eased in fraction space, as the visuals do. */
  shown: number;
  lastFraction: number;
  driveSign: number;
  shiftT: number;
  glideT: number;
  glideMs: number;
  glideFrom: number;
  glideTo: number;
  pendingShift: (() => void) | null;
}

function machine(): Machine {
  return {
    top: CAR.top,
    shown: 0,
    lastFraction: 0,
    driveSign: -1,
    shiftT: 1,
    glideT: 1,
    glideMs: HOME_MS,
    glideFrom: CAR.top,
    glideTo: CAR.top,
    pendingShift: null,
  };
}

/** One frame of the same sequence `LiftVisual` runs: ease, advance, place. */
function frame(m: Machine, target: number): number {
  m.shown = approach(m.shown, toFraction(target), FRAME_MS, EASE_TAU);
  if (m.shiftT < 1) m.shiftT = Math.min(1, m.shiftT + FRAME_MS / SHIFT_MS);
  if (m.glideT < 1) {
    m.glideT = Math.min(1, m.glideT + FRAME_MS / m.glideMs);
    if (m.glideT === 1 && m.pendingShift) {
      m.pendingShift();
      m.pendingShift = null;
    }
  }

  const fraction = m.shown;
  const input: CarriageInput = {
    top: m.top,
    fraction,
    lastFraction: m.lastFraction,
    driveSign: m.driveSign,
    held: m.shiftT < 1,
    glide: m.glideT,
    glideFrom: m.glideFrom,
    glideTo: m.glideTo,
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

/** Hands the car to the machine for a scripted move. */
function glide(m: Machine, to: number, ms: number): void {
  m.glideFrom = m.top;
  m.glideTo = to;
  m.glideMs = ms;
  m.glideT = Math.abs(to - m.top) < 0.5 ? 1 : 0;
}

/** What the controller does when a leg ends: run the car into its floor. */
function land(m: Machine): void {
  glide(m, m.driveSign > 0 ? CAR_BOTTOM : CAR.top, LAND_MS);
}

/**
 * What the app does between phases: land the car, then cross the belt with the
 * brake on. The shift queues behind the landing, exactly as the lift does.
 */
function reverse(m: Machine, drive: 'up' | 'down'): void {
  land(m);
  const settle = (): void => {
    m.driveSign = drive === 'down' ? 1 : -1;
    m.shiftT = 0;
  };
  if (m.glideT >= 1) settle();
  else m.pendingShift = settle;
}

/** What `reset()` does: aim at zero and drive the car home from where it is. */
function reset(m: Machine): void {
  m.driveSign = -1;
  m.pendingShift = null;
  m.shiftT = 1;
  glide(m, CAR.top, HOME_MS);
  m.glideT = 0;
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
  land(m); // no reversal after the upload, so the controller lands it
  worst = Math.max(worst, hold(m, 0, LAND_MS + 200));
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

  it('runs a download into the bottom floor, not wherever the reading stopped', () => {
    const m = machine();
    m.glideT = 1;
    m.driveSign = 1;
    hold(m, 940, 6000);
    // 940 Mbps on a scale that goes to ten gigabits: three quarters down.
    expect(m.top).toBeLessThan(CAR_BOTTOM - 10);
    land(m);
    hold(m, 940, LAND_MS + 200);
    expect(Math.abs(m.top - CAR_BOTTOM)).toBeLessThan(ON_THE_FLOOR);
  });

  it('runs an upload into the top floor', () => {
    const m = machine();
    m.glideT = 1;
    m.top = CAR_BOTTOM;
    m.driveSign = -1;
    hold(m, 780, 6000);
    expect(m.top).toBeGreaterThan(CAR.top + 10);
    land(m);
    hold(m, 780, LAND_MS + 200);
    expect(Math.abs(m.top - CAR.top)).toBeLessThan(ON_THE_FLOOR);
  });

  it('lands smoothly, never faster than the needle could drive it', () => {
    const m = machine();
    m.glideT = 1;
    m.driveSign = 1;
    land(m); // the longest possible landing: the whole shaft, from rest
    let worst = 0;
    for (let t = 0; t < LAND_MS + 200; t += FRAME_MS) worst = Math.max(worst, frame(m, 0));
    expect(worst).toBeLessThanOrEqual(MAX_STEP);
    expect(Math.abs(m.top - CAR_BOTTOM)).toBeLessThan(ON_THE_FLOOR);
  });

  it('does not shift the reversing gear until the car has stopped', () => {
    const m = machine();
    m.glideT = 1;
    m.driveSign = 1;
    hold(m, 940, 6000);
    reverse(m, 'up');
    // The landing is under way, so the belt has not started crossing.
    expect(m.glideT).toBeLessThan(1);
    expect(m.shiftT).toBe(1);
    hold(m, 0, LAND_MS + FRAME_MS);
    expect(Math.abs(m.top - CAR_BOTTOM)).toBeLessThan(ON_THE_FLOOR);
    expect(m.shiftT).toBeLessThan(1); // and only now does it cross
  });

  it('lands exactly on the top floor when homing finishes', () => {
    const m = machine();
    m.top = CAR_BOTTOM;
    reset(m);
    hold(m, 0, HOME_MS + FRAME_MS);
    expect(m.glideT).toBe(1);
    expect(m.top).toBeCloseTo(CAR.top, 3);
  });

  it('holds the car still while the belt is being crossed', () => {
    const m = machine();
    m.glideT = 1;
    m.driveSign = 1;
    m.top = CAR_BOTTOM;
    m.shown = toFraction(940);
    m.lastFraction = toFraction(940);
    reverse(m, 'up'); // already at the floor, so the shift starts at once
    expect(m.shiftT).toBe(0);
    const before = m.top;
    hold(m, 0, SHIFT_MS - FRAME_MS);
    expect(m.top).toBe(before);
  });

  it('stays within the shaft', () => {
    const m = machine();
    m.glideT = 1;
    m.driveSign = 1;
    for (let i = 0; i < 400; i += 1) frame(m, 10_000);
    expect(m.top).toBeLessThanOrEqual(CAR_BOTTOM);
    expect(m.top).toBeGreaterThanOrEqual(CAR.top);
  });
});
