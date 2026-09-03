import { describe, expect, it } from 'vitest';
import { bearing, distance, polar, toRadians } from './geometry';
import { drumPin, drumTakeUp, freeLength, matchingLeverArm, wrapSpan, wrappedLength } from './rope';

describe('drumTakeUp', () => {
  it('is arc length, so a bigger drum takes up more for the same angle', () => {
    expect(drumTakeUp(9, toRadians(79.76))).toBeCloseTo(12.53, 2);
    expect(drumTakeUp(18, toRadians(79.76))).toBeCloseTo(25.06, 2);
  });
});

describe('matchingLeverArm', () => {
  it('sizes a lever to pay out exactly what a drum takes up', () => {
    const travel = toRadians(79.76);
    const arm = matchingLeverArm(9, travel, travel);
    expect(arm).toBeCloseTo(9);
    // Same angle, same arm: a 1:1 linkage conserves rope.
    expect(drumTakeUp(arm, travel)).toBeCloseTo(drumTakeUp(9, travel));
  });

  it('trades arm length against throw when the angles differ', () => {
    const arm = matchingLeverArm(9, toRadians(80), toRadians(40));
    expect(arm).toBeCloseTo(18);
  });
});

describe('wrap on a drum', () => {
  const centre = { x: 0, y: 0 };
  const tangent = polar(centre, 9, 0);

  it('measures the arc from where the rope lands to where it is made off', () => {
    const anchor = polar(centre, 9, Math.PI / 2);
    expect(wrapSpan(centre, tangent, anchor)).toBeCloseTo(Math.PI / 2);
    expect(wrappedLength(9, centre, tangent, anchor)).toBeCloseTo((9 * Math.PI) / 2);
  });

  it('changes by exactly the take-up as the drum turns', () => {
    const travel = toRadians(79.76);
    // The pin starts far enough round that the wrap never passes the tangent.
    const before = wrappedLength(9, centre, tangent, drumPin(centre, 9, 2.0, 0));
    const after = wrappedLength(9, centre, tangent, drumPin(centre, 9, 2.0, -travel));
    expect(Math.abs(before - after)).toBeCloseTo(drumTakeUp(9, travel), 6);
  });

  it('measures the long way round once the pin passes the tangent', () => {
    // Worth pinning down: this is why a drum's pin has to be seated so the
    // wrap stays on one side through the whole throw.
    const justBefore = wrapSpan(centre, tangent, drumPin(centre, 9, 0.1, 0));
    const justAfter = wrapSpan(centre, tangent, drumPin(centre, 9, -0.1, 0));
    expect(justBefore).toBeCloseTo(0.1);
    expect(justAfter).toBeCloseTo(Math.PI * 2 - 0.1);
  });
});

describe('freeLength', () => {
  it('is the tangent length, by Pythagoras on the radius', () => {
    const centre = { x: 0, y: 0 };
    const from = { x: 60, y: 0 };
    expect(freeLength(from, centre, 9)).toBeCloseTo(Math.sqrt(60 * 60 - 81));
  });

  it('agrees with the distance to the tangent point it describes', () => {
    const centre = { x: 140, y: 100 };
    const from = { x: 84, y: 122 };
    const t = polar(centre, 9, bearing(centre, from) + Math.acos(9 / distance(centre, from)));
    expect(freeLength(from, centre, 9)).toBeCloseTo(distance(from, t));
  });
});
