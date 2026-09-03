import { describe, expect, it } from 'vitest';
import {
  bearing,
  bisect,
  distance,
  polar,
  segmentDistance,
  tangentPoint,
  wrapPi,
  wrapTau,
} from './geometry';

describe('angle wrapping', () => {
  it('brings angles into [-pi, pi)', () => {
    expect(wrapPi(0)).toBeCloseTo(0);
    expect(wrapPi(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(wrapPi(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    // Half a turn lands on the lower edge, not the upper one.
    expect(wrapPi(Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(wrapPi(Math.PI - 1e-9)).toBeCloseTo(Math.PI);
  });

  it('brings angles into [0, 2pi)', () => {
    expect(wrapTau(-Math.PI / 2)).toBeCloseTo(Math.PI * 1.5);
    expect(wrapTau(Math.PI * 4.25)).toBeCloseTo(Math.PI * 0.25);
  });
});

describe('tangentPoint', () => {
  const centre = { x: 0, y: 0 };

  it('lands on the circle', () => {
    const from = { x: 10, y: 4 };
    for (const side of [1, -1] as const) {
      const t = tangentPoint(from, centre, 3, side);
      expect(distance(centre, t)).toBeCloseTo(3);
    }
  });

  it('is perpendicular to the radius, which is what makes it a tangent', () => {
    const from = { x: -12, y: 7 };
    const t = tangentPoint(from, centre, 4, 1);
    const radial = { x: t.x - centre.x, y: t.y - centre.y };
    const along = { x: from.x - t.x, y: from.y - t.y };
    expect(radial.x * along.x + radial.y * along.y).toBeCloseTo(0);
  });

  it('gives the two sides, one each way round', () => {
    const from = { x: 0, y: 20 };
    const a = tangentPoint(from, centre, 5, 1);
    const b = tangentPoint(from, centre, 5, -1);
    expect(a.x).toBeCloseTo(-b.x);
    expect(a.y).toBeCloseTo(b.y);
  });

  it('refuses a point inside the circle', () => {
    expect(() => tangentPoint({ x: 1, y: 1 }, centre, 5, 1)).toThrow(RangeError);
  });
});

describe('segmentDistance', () => {
  it('measures to the nearest point on the segment, not the infinite line', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(segmentDistance(a, b, { x: 5, y: 3 })).toBeCloseTo(3);
    // Beyond the end, the nearest point is the endpoint itself.
    expect(segmentDistance(a, b, { x: 14, y: 0 })).toBeCloseTo(4);
  });
});

describe('bisect', () => {
  it('solves a distance constraint', () => {
    const centre = { x: 0, y: 0 };
    // Find the angle at which a point on a radius-10 circle is 8 from (10, 0).
    const root = bisect((a) => distance(polar(centre, 10, a), { x: 10, y: 0 }) - 8, 0.1, 2);
    expect(distance(polar(centre, 10, root), { x: 10, y: 0 })).toBeCloseTo(8);
  });

  it('refuses an interval that does not bracket a root', () => {
    expect(() => bisect((x) => x * x + 1, -1, 1)).toThrow(RangeError);
  });
});

describe('polar and bearing round-trip', () => {
  it('agrees with itself', () => {
    const centre = { x: 3, y: -4 };
    const p = polar(centre, 7, 1.1);
    expect(distance(centre, p)).toBeCloseTo(7);
    expect(bearing(centre, p)).toBeCloseTo(1.1);
  });
});
