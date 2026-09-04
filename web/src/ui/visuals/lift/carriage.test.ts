import { describe, expect, it } from 'vitest';
import { approach, limitStep } from '../../primitives/anim';
import { EASE_TAU, SWEEP_MS, sweepMs, toFraction } from '../scale';
import { carriageTop, type CarriageInput } from './carriage';
import { CAR, CAR_BOTTOM, CAR_REST, TRAVEL, rideMs } from './layout';
import { HOME_MS, LAND_MS, RIDE_FULL_MS, SHIFT_MS } from '../tempo';

const FRAME_MS = 16;

/**
 * The most the car may move in one frame under any circumstances.
 *
 * The fastest legitimate move is a full-shaft landing: `easeInOut` peaks at
 * three times its average rate, so that is the ceiling everything else has to
 * fit under. Anything beyond it is a teleport, which is the bug this file
 * exists to catch.
 */
const MAX_STEP = 3.05 * (TRAVEL / LAND_MS) * FRAME_MS;

/** What the needle alone may drive the car through in a frame, at its limit. */
const NEEDLE_STEP = (FRAME_MS / SWEEP_MS) * TRAVEL;

/**
 * How close to a floor counts as landed.
 *
 * Not exactly on it: the belt stays connected, so once a scripted move hands
 * back to the drive the last of the needle's decay nudges the car a fraction
 * of a unit. That is the mechanism behaving correctly, and it is about two
 * thousandths of a pixel on a shaft that renders under a pixel per unit.
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
  pendingRide: number | null;
  pendingRideMs: number;
  pendingShift: (() => void) | null;
}

function machine(): Machine {
  return {
    top: CAR_REST,
    shown: 0,
    lastFraction: 0,
    driveSign: -1,
    shiftT: 1,
    glideT: 1,
    glideMs: HOME_MS,
    glideFrom: CAR_REST,
    glideTo: CAR_REST,
    pendingRide: null,
    pendingRideMs: 0,
    pendingShift: null,
  };
}

/** One frame of the same sequence `LiftVisual` runs: ease, advance, place. */
function frame(m: Machine, target: number): number {
  // Eased for shape, then capped for speed, exactly as the visuals do.
  const wanted = approach(m.shown, toFraction(target), FRAME_MS, EASE_TAU) - m.shown;
  m.shown += limitStep(wanted, FRAME_MS, SWEEP_MS);
  if (m.shiftT < 1) m.shiftT = Math.min(1, m.shiftT + FRAME_MS / SHIFT_MS);
  if (m.glideT < 1) {
    m.glideT = Math.min(1, m.glideT + FRAME_MS / m.glideMs);
    if (m.glideT === 1) {
      if (m.pendingRide !== null) {
        glide(m, m.pendingRide, m.pendingRideMs);
        m.pendingRide = null;
      } else if (m.pendingShift) {
        m.pendingShift();
        m.pendingShift = null;
      }
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

/** A journey at lift speed, queued behind whatever the machine is doing. */
function ride(m: Machine, to: number): number {
  const busy = m.glideT < 1;
  const ms = rideMs(Math.abs(to - (busy ? m.glideTo : m.top)));
  if (busy) {
    m.pendingRide = to;
    m.pendingRideMs = ms;
  } else {
    glide(m, to, ms);
  }
  return ms;
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

/** What `reset()` does: aim at zero and hold the car at its floor as it falls. */
function reset(m: Machine): void {
  m.driveSign = -1;
  m.pendingShift = null;
  m.pendingRide = null;
  m.shiftT = 1;
  // Long enough for the needle's fall AND for the distance home — see the
  // comment in reset(). Sizing it from the fall alone throws the car.
  const fall = m.shown > 0 ? sweepMs(m.shown) : 0;
  glide(m, CAR_REST, Math.max(fall, rideMs(Math.abs(CAR_REST - m.top))));
  if (m.shown > 0) m.glideT = 0;
}

/** The whole run: settle, called up during the ping, down, up, home again. */
function run(m: Machine, downloadMbps: number, uploadMbps: number): number {
  let worst = 0;
  reset(m);
  const opening = ride(m, CAR.top); // queued behind the settle
  worst = Math.max(worst, hold(m, 0, SWEEP_MS + opening + 200));
  reverse(m, 'down');
  worst = Math.max(worst, hold(m, 0, LAND_MS + SHIFT_MS + 250));
  worst = Math.max(worst, hold(m, downloadMbps, 8000));
  reverse(m, 'up');
  worst = Math.max(worst, hold(m, 0, LAND_MS + SHIFT_MS + 250));
  worst = Math.max(worst, hold(m, uploadMbps, 8000));
  ride(m, CAR_REST); // park, once the results are in
  worst = Math.max(worst, hold(m, uploadMbps, RIDE_FULL_MS + 200));
  return worst;
}

describe('carriageTop', () => {
  it('never jumps across a whole run', () => {
    const m = machine();
    expect(run(m, 940, 780)).toBeLessThanOrEqual(MAX_STEP);
  });

  it('starts and ends the run at the ground floor', () => {
    const m = machine();
    expect(m.top).toBe(CAR_REST);
    run(m, 940, 780);
    expect(Math.abs(m.top - CAR_REST)).toBeLessThan(ON_THE_FLOOR);
  });

  it('is called all the way up while the ping is taken', () => {
    const m = machine();
    // A second run: the previous one left the needle near full scale, so
    // there is a real fall to wait for before the car may be called up.
    m.shown = toFraction(9500);
    m.lastFraction = m.shown;
    const settle = sweepMs(m.shown);
    reset(m);
    const opening = ride(m, CAR.top);
    hold(m, 0, settle - 2 * FRAME_MS);
    // Still at the bottom: the ride waits for the needle to finish falling.
    expect(Math.abs(m.top - CAR_REST)).toBeLessThan(ON_THE_FLOOR);
    hold(m, 0, opening + 3 * FRAME_MS);
    expect(Math.abs(m.top - CAR.top)).toBeLessThan(ON_THE_FLOOR);
  });

  it('waits for nothing on a first run, when the needle is already down', () => {
    const m = machine();
    reset(m);
    expect(sweepMs(m.shown)).toBeLessThan(sweepMs(1));
  });

  it('rides at one speed, so a longer trip takes longer', () => {
    expect(rideMs(TRAVEL)).toBe(RIDE_FULL_MS);
    expect(rideMs(TRAVEL / 2)).toBe(RIDE_FULL_MS / 2);
    expect(rideMs(0)).toBeGreaterThan(0); // a floor, so nothing is instant
  });

  it('never jumps when a second run resets a car left up the shaft', () => {
    const m = machine();
    run(m, 940, 780);
    // Leave it stopped mid-shaft with the needle still reading, the state a
    // cancelled test ends in — the case that used to teleport it.
    m.top = CAR.top;
    m.shown = toFraction(940);
    m.lastFraction = toFraction(940);
    expect(run(m, 620, 450)).toBeLessThanOrEqual(MAX_STEP);
  });

  it('does not throw the car home when Start is pressed during the park', () => {
    // The park rides the car home over 2400ms. Pressing Start partway through
    // leaves it far from the ground floor with the needle wherever the upload
    // left it — and on a slow link that needle is near the stop, so a hold
    // sized from its fall alone was only 200ms for most of a shaft: 19.9 units
    // in one frame. Every reading has to be safe, not just the fast ones.
    for (const mbps of [1.5, 12, 120, 940, 8741]) {
      const m = machine();
      m.top = CAR.top; // as far from home as the car can be
      m.shown = toFraction(mbps);
      m.lastFraction = m.shown;
      reset(m);
      let worst = 0;
      for (let t = 0; t < RIDE_FULL_MS + 400; t += FRAME_MS) {
        worst = Math.max(worst, frame(m, 0));
      }
      expect(worst).toBeLessThanOrEqual(MAX_STEP);
      expect(Math.abs(m.top - CAR_REST)).toBeLessThan(ON_THE_FLOOR);
    }
  });

  it('runs a download into the bottom floor, not wherever the reading stopped', () => {
    const m = machine();
    m.glideT = 1;
    m.top = CAR.top;
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
    m.top = CAR.top;
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
    m.top = CAR.top;
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

  it('holds the car for at least as long as the needle takes to fall', () => {
    // The needle turns the sheave through the belt, so a return sweep that
    // outlasts the machine's hold on the car would drag it up the shaft.
    // Between phases the hold is the landing plus the whole belt shift; at a
    // reset it is the homing glide, sized from the same sweep.
    expect(LAND_MS + SHIFT_MS).toBeGreaterThanOrEqual(SWEEP_MS);
  });

  it('drives the car at one speed whatever the link is doing', () => {
    // Without a speed limit the needle's rate is proportional to the distance
    // left, so a ten-gigabit reading moved the car across the shaft in a third
    // of a second while a slow link ambled — the same animation at whatever
    // speed the link happened to dictate.
    const fast = machine();
    const slow = machine();
    for (const m of [fast, slow]) {
      m.glideT = 1;
      m.top = CAR.top;
      m.driveSign = 1;
    }
    let fastWorst = 0;
    let slowWorst = 0;
    for (let t = 0; t < 4000; t += FRAME_MS) {
      fastWorst = Math.max(fastWorst, frame(fast, 9500));
      slowWorst = Math.max(slowWorst, frame(slow, 60));
    }
    expect(fastWorst).toBeLessThanOrEqual(NEEDLE_STEP + 1e-9);
    expect(slowWorst).toBeLessThanOrEqual(NEEDLE_STEP + 1e-9);
    // Both reach the limit, so they travel at the same speed and simply stop
    // at different floors — which is the whole point.
    expect(fastWorst).toBeCloseTo(slowWorst, 9);
  });

  it('stays within the shaft', () => {
    const m = machine();
    m.glideT = 1;
    m.top = CAR.top;
    m.driveSign = 1;
    for (let i = 0; i < 400; i += 1) frame(m, 10_000);
    expect(m.top).toBeLessThanOrEqual(CAR_BOTTOM);
    expect(m.top).toBeGreaterThanOrEqual(CAR.top);
  });
});
