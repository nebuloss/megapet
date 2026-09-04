import { describe, expect, it } from 'vitest';
import { BeltDrive, Brake, GearPair, Rotation, Travel } from './drive';
import { gear } from './gear';

const MODULE = 2.6;

/** The lift's train: needle -> hub -> lay -> belt -> brake -> sheave -> car. */
function train(carAt = 206) {
  const car = new Travel(carAt, 206, 298, 26);
  const sheave = new Rotation(car);
  const brake = new Brake(sheave);
  const belt = new BeltDrive(14, 14, brake);
  const lay = new Rotation(belt);
  const pair = new GearPair(gear(MODULE, 15, 140, 100), gear(MODULE, 20, 97, 116), lay);
  const hub = new Rotation(pair);
  return { hub, pair, lay, belt, brake, sheave, car };
}

describe('a drive train', () => {
  it('carries motion from the needle all the way to the car', () => {
    const t = train(250);
    t.hub.drive(1);
    expect(t.hub.phase).toBeCloseTo(1, 12);
    expect(t.lay.phase).toBeCloseTo(-15 / 20, 12); // meshed gears turn opposite ways
    // And because they do, an open belt raises the car as the needle rises.
    // Which way round that is belongs to the layout, not to the train.
    expect(t.car.value).toBeCloseTo(250 - (15 / 20) * 26, 9);
  });

  it('refuses a pair whose teeth cannot engage', () => {
    // The invariant the free functions could only describe in a comment: two
    // gears cut to different modules have teeth of different sizes.
    expect(() => new GearPair(gear(2.6, 15, 0, 0), gear(4, 20, 0, 50))).toThrow(RangeError);
    expect(() => new GearPair(gear(2.6, 15, 0, 0), gear(2.6, 20, 0, 50))).not.toThrow();
  });

  it('reverses the car when the belt is crossed', () => {
    const open = train(250);
    const crossed = train(250);
    crossed.belt.setCrossed(true);
    open.hub.drive(1);
    crossed.hub.drive(1);
    expect(open.car.value - 250).toBeCloseTo(-(crossed.car.value - 250), 12);
  });

  it('cannot throw the car when the direction changes', () => {
    // This is the bug this shape exists to prevent. Driving the train with a
    // reversed belt moves the car by one increment, not to a mirrored
    // position — where `top = anchor + sign * input * travel` would have
    // jumped most of the shaft the instant the sign flipped.
    const t = train(250);
    for (let i = 0; i < 50; i += 1) t.hub.drive(0.02);
    const before = t.car.value;
    t.belt.setCrossed(true);
    t.hub.drive(0.02);
    expect(Math.abs(t.car.value - before)).toBeLessThan(0.6);
  });

  it('lets the brake hold the car while everything upstream keeps turning', () => {
    const t = train(250);
    t.brake.set = true;
    t.hub.drive(1);
    expect(t.car.value).toBe(250); // the belt slips, which is undrawable and so free
    expect(t.hub.phase).toBeCloseTo(1, 12); // the needle and gears are unaffected
    expect(t.lay.phase).toBeCloseTo(-15 / 20, 12);
    expect(t.sheave.phase).toBe(0); // and the sheave is genuinely stopped
  });

  it('lets the machine take the car over without stopping the mechanism', () => {
    const t = train(250);
    t.car.held = true;
    t.hub.drive(1);
    expect(t.car.value).toBe(250);
    t.car.moveTo(206); // the machine puts it where the mechanism cannot
    expect(t.car.value).toBe(206);
  });

  it('drops what it declines instead of saving it up', () => {
    // A delta is offered once and either used or discarded. Nothing keeps a
    // running total that could arrive all at once when the hold is released.
    const held = train(250);
    held.car.held = true;
    for (let i = 0; i < 100; i += 1) held.hub.drive(0.05);
    held.car.held = false;
    const free = train(250);
    held.hub.drive(0.05);
    free.hub.drive(0.05);
    expect(held.car.value - 250).toBeCloseTo(free.car.value - 250, 12);
  });

  it('keeps the car in the shaft however hard it is driven', () => {
    const t = train(250);
    for (let i = 0; i < 500; i += 1) t.hub.drive(1);
    expect(t.car.value).toBe(206); // hard against the top stop
    t.belt.setCrossed(true);
    for (let i = 0; i < 500; i += 1) t.hub.drive(1);
    expect(t.car.value).toBe(298); // and the bottom, once the belt is crossed
  });

  it('is reversible: the same input backwards returns everything home', () => {
    const t = train(250);
    for (let i = 0; i < 40; i += 1) t.hub.drive(0.01);
    for (let i = 0; i < 40; i += 1) t.hub.drive(-0.01);
    expect(t.hub.phase).toBeCloseTo(0, 12);
    expect(t.car.value).toBeCloseTo(250, 9);
  });
});
