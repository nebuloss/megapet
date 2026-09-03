import { describe, expect, it } from 'vitest';
import { distance, polar, toRadians } from './geometry';
import { detentLift, seatSpringPin, springLength } from './linkage';

describe('seatSpringPin', () => {
  const pivot = { x: 140, y: 100 };
  const anchor = { x: 198, y: 76 };
  const radius = 11;
  const stretched = toRadians(-54.859);
  const relaxed = toRadians(24.899);

  it('finds a seat that really is longer at the stretched position', () => {
    const base = seatSpringPin(pivot, radius, anchor, stretched, relaxed);
    const long = springLength(pivot, radius, base, stretched, anchor);
    const short = springLength(pivot, radius, base, relaxed, anchor);
    expect(long).toBeGreaterThan(short);
  });

  it('beats seating the pin by eye', () => {
    const base = seatSpringPin(pivot, radius, anchor, stretched, relaxed);
    const solved =
      springLength(pivot, radius, base, stretched, anchor) -
      springLength(pivot, radius, base, relaxed, anchor);

    // Any other seat gives at most the same extension, and usually far less.
    for (let i = 0; i < 36; i++) {
      const guess = (i / 36) * Math.PI * 2;
      const gain =
        springLength(pivot, radius, guess, stretched, anchor) -
        springLength(pivot, radius, guess, relaxed, anchor);
      expect(gain).toBeLessThanOrEqual(solved + 1e-6);
    }
  });

  it('cannot stretch further than the pin can travel', () => {
    const base = seatSpringPin(pivot, radius, anchor, stretched, relaxed);
    const gain =
      springLength(pivot, radius, base, stretched, anchor) -
      springLength(pivot, radius, base, relaxed, anchor);
    const chord = distance(
      polar(pivot, radius, base + stretched),
      polar(pivot, radius, base + relaxed),
    );
    expect(gain).toBeLessThanOrEqual(chord + 1e-9);
  });
});

describe('detentLift', () => {
  const seats = [24.899, -54.859];

  it('is zero in either seat', () => {
    expect(detentLift(seats[0]!, seats, 2.2, 7)).toBeCloseTo(0);
    expect(detentLift(seats[1]!, seats, 2.2, 7)).toBeCloseTo(0);
  });

  it('is fully lifted between the seats', () => {
    expect(detentLift(-15, seats, 2.2, 7)).toBeCloseTo(2.2);
  });

  it('rides out gradually as the part leaves a seat', () => {
    const partway = detentLift(seats[0]! - 3.5, seats, 2.2, 7);
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(2.2);
  });
});
