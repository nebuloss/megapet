import { describe, expect, it } from 'vitest';
import { boundsHeight, boundsWidth, fitTransform, fitsInside, placedBounds } from './fit';
import type { Bounds, Rect } from './fit';

const content: Bounds = { minX: -26, minY: -27, maxX: 26, maxY: 24 };

describe('fitTransform', () => {
  it('centres the content in the rect', () => {
    const rect: Rect = { x: 100, y: 50, width: 80, height: 60 };
    const placed = placedBounds(content, fitTransform(content, rect));
    expect((placed.minX + placed.maxX) / 2).toBeCloseTo(rect.x + rect.width / 2);
    expect((placed.minY + placed.maxY) / 2).toBeCloseTo(rect.y + rect.height / 2);
  });

  it('scales to whichever axis runs out first', () => {
    // A wide rect: height is the constraint.
    const wide: Rect = { x: 0, y: 0, width: 500, height: 51 };
    expect(fitTransform(content, wide).scale).toBeCloseTo(51 / boundsHeight(content));
    // A tall one: width is.
    const tall: Rect = { x: 0, y: 0, width: 52, height: 500 };
    expect(fitTransform(content, tall).scale).toBeCloseTo(52 / boundsWidth(content));
  });

  it('always leaves the content inside the rect', () => {
    for (const rect of [
      { x: 0, y: 0, width: 40, height: 40 },
      { x: 91, y: 11, width: 46, height: 48 },
      { x: -20, y: 5, width: 200, height: 30 },
    ]) {
      expect(fitsInside(content, fitTransform(content, rect), rect)).toBe(true);
    }
  });

  it('honours padding', () => {
    const rect: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const inner: Rect = { x: 5, y: 5, width: 90, height: 90 };
    const placement = fitTransform(content, rect, { padding: 5 });
    expect(fitsInside(content, placement, inner)).toBe(true);
  });

  it('will not enlarge past maxScale', () => {
    const huge: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
    expect(fitTransform(content, huge, { maxScale: 1 }).scale).toBeCloseTo(1);
  });

  it('is what makes the box the only thing to adjust', () => {
    // Growing the box grows the content, with no other constant to update.
    const small = fitTransform(content, { x: 0, y: 0, width: 46, height: 34 });
    const large = fitTransform(content, { x: 0, y: 0, width: 46, height: 48 });
    expect(large.scale).toBeGreaterThan(small.scale);
  });

  it('refuses content with no extent', () => {
    const flat: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 10 };
    expect(() => fitTransform(flat, { x: 0, y: 0, width: 10, height: 10 })).toThrow(RangeError);
  });
});
