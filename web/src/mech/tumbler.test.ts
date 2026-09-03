import { describe, expect, it } from 'vitest';
import { distance, toRadians } from './geometry';
import { meshDistance, meshError } from './gear';
import {
  buildTumbler,
  outputRatio,
  reversePhase,
  seatTakeUp,
  seatTravel,
  swingCentre,
  swingPhase,
  type Seat,
  type TumblerSpec,
} from './tumbler';

const SPEC: TumblerSpec = {
  module: 2.6,
  hub: { teeth: 15, at: { x: 140, y: 100 } },
  output: { teeth: 20, at: { x: 140, y: 166 } },
  swing: { teeth: 10 },
  reverse: { teeth: 9, x: 170, above: true },
};

const t = buildTumbler(SPEC);

describe('layout', () => {
  it('seats the reverse gear at exactly one mesh distance from the output', () => {
    expect(distance(t.reverse, t.output)).toBeCloseTo(meshDistance(t.reverse, t.output));
  });

  it('carries the swing gear at one mesh distance from the hub, at every yoke angle', () => {
    for (const yoke of [-60, -20, 0, 25, 60]) {
      expect(distance(swingCentre(t, yoke), t.hub)).toBeCloseTo(meshDistance(t.hub, t.swing));
    }
  });

  it('solves a yoke seat where the swing gear meshes the output', () => {
    const swing = swingCentre(t, t.seats.direct);
    expect(distance(swing, t.output)).toBeCloseTo(meshDistance(t.swing, t.output));
  });

  it('solves a yoke seat where the swing gear meshes the reverse gear instead', () => {
    const swing = swingCentre(t, t.seats.reversed);
    expect(distance(swing, t.reverse)).toBeCloseTo(meshDistance(t.swing, t.reverse));
  });

  it('keeps the disengaged gear clear at each seat', () => {
    const tipGap = (a: number, b: number): number => a + b - 2 * t.module;
    const direct = swingCentre(t, t.seats.direct);
    expect(distance(direct, t.reverse)).toBeGreaterThan(
      tipGap(t.swing.radius, t.reverse.radius),
    );
    const reversed = swingCentre(t, t.seats.reversed);
    expect(distance(reversed, t.output)).toBeGreaterThan(
      tipGap(t.swing.radius, t.output.radius),
    );
  });

  it('refuses a layout whose gears cannot reach', () => {
    expect(() => buildTumbler({ ...SPEC, reverse: { teeth: 9, x: 400, above: true } })).toThrow(
      RangeError,
    );
  });
});

describe('ratios', () => {
  it('is the hub/output tooth ratio either way — the idlers cancel', () => {
    expect(Math.abs(outputRatio(t, 'direct'))).toBeCloseTo(15 / 20);
    expect(Math.abs(outputRatio(t, 'reversed'))).toBeCloseTo(15 / 20);
  });

  it('reverses sign between the seats, which is the whole point', () => {
    expect(outputRatio(t, 'direct')).toBeCloseTo(-outputRatio(t, 'reversed'));
  });

  it('travels a sensible arc between seats', () => {
    expect(seatTravel(t)).toBeGreaterThan(40);
    expect(seatTravel(t)).toBeLessThan(120);
  });
});

describe('tooth indexing across the train', () => {
  it('holds the hub/swing mesh while the needle turns', () => {
    for (const hubPhase of [0, 0.7, 2.1, 4.712]) {
      const yoke = toRadians(t.seats.direct);
      expect(
        meshError(t.hub, hubPhase, swingCentre(t, t.seats.direct), swingPhase(t, hubPhase, yoke)),
      ).toBeCloseTo(0, 10);
    }
  });

  it('holds the hub/swing mesh while the yoke rocks', () => {
    for (const seat of [t.seats.direct, 0, t.seats.reversed]) {
      const yoke = toRadians(seat);
      expect(
        meshError(t.hub, 0, swingCentre(t, seat), swingPhase(t, 0, yoke)),
      ).toBeCloseTo(0, 10);
    }
  });

  it('holds the output/reverse mesh while the output turns', () => {
    for (const outputPhase of [0, 1, 3.53]) {
      expect(
        meshError(t.output, outputPhase, t.reverse, reversePhase(t, outputPhase)),
      ).toBeCloseTo(0, 10);
    }
  });
});

describe('seatTakeUp', () => {
  const seats: Seat[] = ['direct', 'reversed'];

  it('brings the engaging pair into mesh', () => {
    for (const seat of seats) {
      const hubPhase = 3.93;
      const outputPhase = 0;
      const take = seatTakeUp(t, seat, hubPhase, outputPhase);
      const swing = swingCentre(t, t.seats[seat]);
      const phase = swingPhase(t, hubPhase, toRadians(t.seats[seat]));
      const corrected = outputPhase + take;
      const error =
        seat === 'direct'
          ? meshError(swing, phase, t.output, corrected)
          : meshError(swing, phase, t.reverse, reversePhase(t, corrected));
      expect(error).toBeCloseTo(0, 8);
    }
  });

  it('never asks the output to turn more than half a tooth', () => {
    const limit = Math.PI / t.output.teeth;
    for (const seat of seats) {
      for (let i = 0; i < 48; i++) {
        const take = seatTakeUp(t, seat, (i / 48) * Math.PI * 2, 0);
        expect(Math.abs(take)).toBeLessThanOrEqual(limit + 1e-9);
      }
    }
  });
});
