import { describe, expect, it } from 'vitest';
import { sweepMs } from '../../scale';
import { CAR, CAR_BOTTOM, CAR_REST, LAND_MS, RIDE_FULL_MS, SHEAVE, TRAVEL, rideMs } from '../layout';
import { Car } from './car';

const F = 16;

function run(car: Car, ms: number): void {
  for (let t = 0; t < ms; t += F) car.update(F);
}

describe('the car', () => {
  it('is carried by the rope, one turn of the sheave at a time', () => {
    const car = new Car(250);
    car.drive(0.1);
    expect(car.position).toBeCloseTo(250 + 0.1 * SHEAVE.radius, 9);
  });

  it('ignores the rope while the machine has it', () => {
    const car = new Car(250);
    car.take(CAR.top, 400);
    car.drive(1); // the belt slips; the machine is in charge
    expect(car.position).toBe(250);
    run(car, 500);
    expect(car.position).toBeCloseTo(CAR.top, 9);
    car.drive(0.1); // and the rope has it back
    expect(car.position).toBeGreaterThan(CAR.top);
  });

  it('lands on the floor the drive was heading for', () => {
    const down = new Car(250);
    down.land(1);
    run(down, LAND_MS + F);
    expect(down.position).toBeCloseTo(CAR_BOTTOM, 6);

    const up = new Car(250);
    up.land(-1);
    run(up, LAND_MS + F);
    expect(up.position).toBeCloseTo(CAR.top, 6);
  });

  it('rides at one speed, so a longer journey takes longer', () => {
    const far = new Car(CAR.top);
    const near = new Car(CAR_REST - TRAVEL / 4);
    expect(far.rideTo(CAR_REST)).toBe(RIDE_FULL_MS);
    expect(near.rideTo(CAR_REST)).toBeCloseTo(rideMs(TRAVEL / 4), 6);
  });

  it('does not bother with a journey it has already arrived at', () => {
    const car = new Car(CAR_REST);
    expect(car.rideTo(CAR_REST)).toBe(0);
    expect(car.free).toBe(true);
  });

  it('holds long enough for the pointer to fall AND for the distance', () => {
    // Sizing the hold from the fall alone threw the car home: a slow upload
    // leaves the pointer near the stop, so the fall is its 200ms floor, for
    // most of a shaft.
    const car = new Car(CAR.top);
    const fall = sweepMs(0.02); // a pointer barely off the stop
    const held = car.home(fall);
    expect(held).toBeGreaterThanOrEqual(rideMs(TRAVEL));
    let worst = 0;
    let previous = car.position;
    for (let t = 0; t < held + 2 * F; t += F) {
      car.update(F);
      worst = Math.max(worst, Math.abs(car.position - previous));
      previous = car.position;
    }
    expect(worst).toBeLessThan(3.05 * (TRAVEL / LAND_MS) * F);
    expect(car.position).toBeCloseTo(CAR_REST, 6);
  });

  it('still holds when it is already home, so the fall cannot reach it', () => {
    const car = new Car(CAR_REST);
    const held = car.home(1200);
    expect(held).toBe(1200);
    car.update(F);
    car.drive(1); // the pointer falling must not move it
    expect(car.position).toBeCloseTo(CAR_REST, 9);
  });

  it('queues work behind the journey it is making', () => {
    const car = new Car(CAR.top);
    const done: string[] = [];
    car.rideTo(CAR_REST);
    car.order(() => done.push('shift'));
    expect(done).toEqual([]); // not while the car is still running
    run(car, RIDE_FULL_MS + 2 * F);
    expect(done).toEqual(['shift']);
  });

  it('runs work at once when there is no journey to wait for', () => {
    const car = new Car(CAR_REST);
    const done: string[] = [];
    car.order(() => done.push('shift'));
    expect(done).toEqual(['shift']);
  });

  it('does not strand an order behind one that had nowhere to go', () => {
    // An order that starts no journey used to swallow the completion, leaving
    // whatever was behind it waiting for a journey that never came.
    const car = new Car(CAR.top);
    const done: string[] = [];
    car.rideTo(CAR_REST);
    car.order(() => {
      done.push('nothing to do');
      car.rideTo(CAR_REST); // already there: no journey
    });
    car.order(() => done.push('shift'));
    run(car, RIDE_FULL_MS + 2 * F);
    expect(done).toEqual(['nothing to do', 'shift']);
  });

  it('keeps its orders in the sequence they were given', () => {
    const car = new Car(CAR.top);
    const done: number[] = [];
    car.rideTo(CAR_REST);
    for (let i = 0; i < 3; i += 1) car.order(() => done.push(i));
    run(car, RIDE_FULL_MS + 2 * F);
    expect(done).toEqual([0, 1, 2]);
  });

  it('drops queued work, so a new run does not inherit the last one', () => {
    const car = new Car(CAR.top);
    const done: string[] = [];
    car.rideTo(CAR_REST);
    car.order(() => done.push('shift'));
    car.clear();
    run(car, RIDE_FULL_MS + 2 * F);
    expect(done).toEqual([]);
    expect(car.free).toBe(true);
  });

  it('cannot be driven out of the shaft', () => {
    const car = new Car(CAR_REST);
    for (let i = 0; i < 200; i += 1) car.drive(1);
    expect(car.position).toBe(CAR_BOTTOM);
    for (let i = 0; i < 200; i += 1) car.drive(-1);
    expect(car.position).toBe(CAR.top);
  });

  it('can be placed at once, for reduced motion', () => {
    const car = new Car(250);
    car.rideTo(CAR.top);
    car.place(CAR_REST);
    expect(car.position).toBe(CAR_REST);
    expect(car.free).toBe(true);
  });
});
