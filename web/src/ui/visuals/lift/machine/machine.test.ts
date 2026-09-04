import { describe, expect, it } from 'vitest';
import { RecordingScene, toRadians } from '../../../../mech';
import { SWEEP_MS } from '../../scale';
import {
  ARC_LENGTH,
  CAR,
  CAR_BOTTOM,
  CAR_REST,
  DRIVE_RATIO,
  LAND_MS,
  RIDE_FULL_MS,
  SHIFT_MS,
  START_ANGLE,
  SWEEP,
  TRAVEL,
} from '../layout';
import { LiftMachine } from './machine';

const F = 16;

/**
 * The most the car may move in one frame under any circumstances.
 *
 * The fastest legitimate move is a full-shaft landing: `easeInOut` peaks at
 * three times its average rate, so that is the ceiling everything else has to
 * fit under. Anything beyond it is a teleport, which is the bug this file
 * exists to catch.
 */
const MAX_STEP = 3.05 * (TRAVEL / LAND_MS) * F;

/** What the pointer alone may drive the car through in a frame, at its limit. */
const NEEDLE_STEP = (F / SWEEP_MS) * TRAVEL;

/** Positions reach the scene rounded to a hundredth; two samples, so twice. */
const ROUNDING = 0.021;

function drawn(machine: LiftMachine): RecordingScene {
  const scene = new RecordingScene();
  machine.place(scene);
  return scene;
}

/** Where the car has got to, read the way anything else reads it: off the scene. */
function carTop(machine: LiftMachine): number {
  return Number(/[-\d.]+(?=\))/.exec(drawn(machine).transforms.get('car')!)![0]);
}

function angle(machine: LiftMachine, part: string): number {
  return Number(/[-\d.]+(?=\))/.exec(drawn(machine).transforms.get(part)!)![0]);
}

/** Where the pointer stands, 0..1, read off the arc it uncovers. */
function pointerAt(machine: LiftMachine): number {
  return 1 - Number(drawn(machine).attrs.get('valueArc.stroke-dashoffset')) / ARC_LENGTH;
}

/**
 * Runs the machine at one reading, the way the controller drives it: the
 * target is re-sent every frame. Returns the largest single step the car took.
 */
function hold(machine: LiftMachine, mbps: number, ms: number): number {
  let worst = 0;
  let previous = carTop(machine);
  for (let t = 0; t < ms; t += F) {
    machine.aim(mbps);
    machine.update(F);
    const now = carTop(machine);
    worst = Math.max(worst, Math.abs(now - previous));
    previous = now;
  }
  return worst;
}

/** The whole run: home, called up during the ping, down, up, home again. */
function run(machine: LiftMachine, downloadMbps: number, uploadMbps: number): number {
  let worst = 0;
  machine.reset();
  const settle = machine.settleMs();
  const opening = machine.ride(CAR.top);
  worst = Math.max(worst, hold(machine, 0, settle + opening + 200));
  machine.land();
  machine.reverse('down');
  worst = Math.max(worst, hold(machine, 0, LAND_MS + SHIFT_MS + 250));
  worst = Math.max(worst, hold(machine, downloadMbps, 8000));
  machine.land();
  machine.reverse('up');
  worst = Math.max(worst, hold(machine, 0, LAND_MS + SHIFT_MS + 250));
  worst = Math.max(worst, hold(machine, uploadMbps, 8000));
  machine.ride(CAR_REST);
  worst = Math.max(worst, hold(machine, uploadMbps, RIDE_FULL_MS + 400));
  return worst;
}

describe('the lift machine', () => {
  it('never jumps the car, over a whole run', () => {
    const machine = new LiftMachine();
    expect(run(machine, 940, 780)).toBeLessThanOrEqual(MAX_STEP + ROUNDING);
  });

  it('starts and ends a run at the ground floor', () => {
    const machine = new LiftMachine();
    expect(carTop(machine)).toBeCloseTo(CAR_REST, 1);
    run(machine, 940, 780);
    expect(carTop(machine)).toBeCloseTo(CAR_REST, 1);
  });

  it('never jumps when a second run resets a car left up the shaft', () => {
    const machine = new LiftMachine();
    run(machine, 940, 780);
    expect(run(machine, 8741, 1.5)).toBeLessThanOrEqual(MAX_STEP + ROUNDING);
  });

  it('waits for nothing on a first run, and rides at once', () => {
    const machine = new LiftMachine();
    machine.reset();
    expect(machine.settleMs()).toBe(0);
    expect(machine.ride(CAR.top)).toBe(RIDE_FULL_MS);
    hold(machine, 0, RIDE_FULL_MS + 2 * F);
    expect(carTop(machine)).toBeCloseTo(CAR.top, 1);
  });

  it('holds the car home while the pointer falls, on a second run', () => {
    const machine = new LiftMachine();
    hold(machine, 9500, 4000); // a fast leg leaves the pointer near full scale
    expect(carTop(machine)).toBeLessThan(CAR_REST - 10);

    machine.reset();
    const settle = machine.settleMs();
    expect(settle).toBeGreaterThan(0);
    const opening = machine.ride(CAR.top);
    hold(machine, 0, settle - 2 * F);
    // Still at the bottom: the ride up waits for the pointer to finish falling.
    expect(carTop(machine)).toBeCloseTo(CAR_REST, 1);
    hold(machine, 0, opening + 3 * F);
    expect(carTop(machine)).toBeCloseTo(CAR.top, 1);
  });

  it('does not throw the reversing gear until the car has stopped', () => {
    const machine = new LiftMachine();
    machine.reset();
    machine.ride(CAR.top); // called up the shaft while the ping is taken
    hold(machine, 0, RIDE_FULL_MS + 2 * F);
    machine.land();
    machine.reverse('down');
    hold(machine, 0, LAND_MS + SHIFT_MS + 250);
    hold(machine, 940, 6000);
    // 940 Mbps on a scale that goes to ten gigabits: three quarters down.
    expect(carTop(machine)).toBeLessThan(CAR_BOTTOM - 10);

    machine.land();
    machine.reverse('up');
    machine.update(F);
    expect(drawn(machine).flags.get('shifting')).toBe(false);
    hold(machine, 0, LAND_MS + 2 * F);
    // The leg ended on the floor it was heading for, and only now does it cross.
    expect(carTop(machine)).toBeCloseTo(CAR_BOTTOM, 1);
    expect(drawn(machine).flags.get('shifting')).toBe(true);
  });

  it('holds the car still for the whole throw, then hands back no arrears', () => {
    // The delta has to be offered and dropped every frame. Saving it up while
    // the brake is on dumps the lot in the frame the brake comes off.
    const machine = new LiftMachine();
    machine.reset();
    machine.ride(CAR.top); // somewhere with room to move in either direction
    hold(machine, 0, RIDE_FULL_MS + 2 * F);
    machine.reverse('down');
    machine.update(F);
    const before = carTop(machine);
    expect(hold(machine, 9500, SHIFT_MS - 3 * F)).toBeCloseTo(0, 9);
    expect(carTop(machine)).toBe(before);
    // Off the brake, and the car moves at the pointer's own speed, not faster.
    for (let t = 0; t < 400; t += F) {
      const at = carTop(machine);
      machine.aim(9500);
      machine.update(F);
      expect(Math.abs(carTop(machine) - at)).toBeLessThanOrEqual(NEEDLE_STEP + ROUNDING);
    }
  });

  it('turns the gears exactly where the pointer stands', () => {
    const machine = new LiftMachine();
    machine.reset();
    for (const mbps of [0, 12, 940, 9500]) {
      hold(machine, mbps, 3000);
      const hub = START_ANGLE + pointerAt(machine) * SWEEP;
      expect(angle(machine, 'hub')).toBeCloseTo(hub, 1);
      expect(toRadians(angle(machine, 'lay'))).toBeCloseTo(-toRadians(hub) * DRIVE_RATIO, 3);
    }
  });

  it('draws the same picture however many times it is asked', () => {
    const machine = new LiftMachine();
    machine.reset();
    hold(machine, 940, 1200);
    machine.reverse('up');
    hold(machine, 940, 300);
    const first = drawn(machine).snapshot();
    expect(drawn(machine).snapshot()).toBe(first);
    expect(first).not.toContain('NaN');
    // And placing it changes nothing, so a frame painted twice runs the same.
    const painted = new LiftMachine();
    const plain = new LiftMachine();
    for (const m of [painted, plain]) m.reset();
    for (let t = 0; t < 4000; t += F) {
      for (const m of [painted, plain]) {
        m.aim(940);
        m.update(F);
      }
      drawn(painted);
      drawn(painted);
    }
    expect(drawn(painted).snapshot()).toBe(drawn(plain).snapshot());
  });

  it('still gives a complete, correct scene when it may not move', () => {
    const machine = new LiftMachine(() => true);
    machine.reset();
    expect(machine.settleMs()).toBe(0);
    expect(machine.ride(CAR.top)).toBe(0);
    expect(carTop(machine)).toBeCloseTo(CAR.top, 1);

    machine.aim(940);
    machine.reverse('down');
    machine.land();
    expect(carTop(machine)).toBeCloseTo(CAR_BOTTOM, 1);
    expect(machine.reading).toBeCloseTo(940, 6);

    const scene = drawn(machine);
    expect(scene.flags.get('shifting')).toBe(false);
    expect(scene.flags.get('braked')).toBe(false);
    expect(scene.snapshot()).not.toContain('NaN');
  });
});
