import { describe, expect, it } from 'vitest';
import { CROSS_FOR, FORK, LEVER, SHIFT_MS } from '../layout';
import { ReversingGear } from './reversing';

const F = 16;

/** Runs a throw to completion, returning the frame it seated on. */
function run(gear: ReversingGear, ms = SHIFT_MS + 2 * F): number {
  let frames = 0;
  for (let t = 0; t < ms; t += F) {
    frames += 1;
    if (gear.update(F)) return frames;
  }
  return -1;
}

describe('the reversing gear', () => {
  it('derives the belt and the lever from one throw', () => {
    const gear = new ReversingGear();
    gear.seat('up');
    expect(gear.cross).toBeCloseTo(CROSS_FOR.up, 9);
    expect(gear.leverAngle).toBeCloseTo(LEVER.seatUp, 9);
    gear.begin('down');
    run(gear);
    expect(gear.cross).toBeCloseTo(CROSS_FOR.down, 9);
    expect(gear.leverAngle).toBeCloseTo(LEVER.seatDown, 9);
  });

  it('starts a throw from wherever it currently is, so nothing jumps', () => {
    const gear = new ReversingGear();
    gear.seat('up');
    gear.begin('down');
    for (let t = 0; t < SHIFT_MS / 2; t += F) gear.update(F);
    const partway = gear.cross;
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(1);
    gear.begin('up'); // change your mind halfway
    expect(gear.cross).toBeCloseTo(partway, 9);
  });

  it('holds the car for the whole throw, wider than the brake is drawn', () => {
    // The hold is what makes a reversal safe. Narrowing it to match the window
    // the shoe is drawn closing in would let the car move at both ends.
    const gear = new ReversingGear();
    gear.seat('up');
    gear.begin('down');
    let heldEvery = true;
    for (let t = 0; t < SHIFT_MS - F; t += F) {
      gear.update(F);
      if (!gear.holding) heldEvery = false;
    }
    expect(heldEvery).toBe(true);
    gear.update(2 * F);
    expect(gear.holding).toBe(false);
  });

  it('presses the brake on and lets it off again within the throw', () => {
    const gear = new ReversingGear();
    gear.seat('up');
    expect(gear.brakeForce).toBe(0);
    gear.begin('down');
    let peak = 0;
    for (let t = 0; t < SHIFT_MS; t += F) {
      gear.update(F);
      peak = Math.max(peak, gear.brakeForce);
    }
    expect(peak).toBeCloseTo(1, 3);
    expect(gear.brakeForce).toBeCloseTo(0, 3);
  });

  it('has the bear reach for the lever and let go again', () => {
    const gear = new ReversingGear();
    gear.seat('up');
    expect(gear.grip).toBe(0);
    gear.begin('down');
    let peak = 0;
    for (let t = 0; t < SHIFT_MS; t += F) {
      gear.update(F);
      peak = Math.max(peak, gear.grip);
    }
    expect(peak).toBeGreaterThan(0.9);
    expect(gear.grip).toBeCloseTo(0, 3);
  });

  it('swings the fork between its two seats and nowhere else', () => {
    const gear = new ReversingGear();
    gear.seat('up');
    const seats = [FORK.open, FORK.crossed].sort((a, b) => a - b);
    gear.begin('down');
    for (let t = 0; t < SHIFT_MS + F; t += F) {
      gear.update(F);
      expect(gear.forkAngle).toBeGreaterThanOrEqual(seats[0]! - 1e-9);
      expect(gear.forkAngle).toBeLessThanOrEqual(seats[1]! + 1e-9);
    }
  });

  it('reports it has seated exactly once', () => {
    const gear = new ReversingGear();
    gear.seat('up');
    gear.begin('down');
    const frames = run(gear);
    expect(frames).toBeGreaterThan(0);
    expect(gear.update(F)).toBe(false); // and not again
  });

  it('seats at once when asked, for reduced motion', () => {
    const gear = new ReversingGear();
    gear.seat('down');
    expect(gear.throwing).toBe(false);
    expect(gear.cross).toBeCloseTo(CROSS_FOR.down, 9);
    expect(gear.brakeForce).toBe(0);
  });
});
