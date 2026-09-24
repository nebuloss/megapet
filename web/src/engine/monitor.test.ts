import { describe, expect, it } from 'vitest';
import { describeDirections, isBidirectional, type Directions } from './monitor';

const DOWN: Directions = { down: true, up: false };
const UP: Directions = { down: false, up: true };
const BOTH: Directions = { down: true, up: true };

/**
 * Directions are two switches rather than three named modes, so that the
 * engine, the buttons and the graph cannot drift apart over what "both" means.
 * These pin the only derived facts anything reads off them.
 */
describe('monitor directions', () => {
  it('recognises a two-way session, and only a two-way session', () => {
    expect(isBidirectional(BOTH)).toBe(true);
    expect(isBidirectional(DOWN)).toBe(false);
    expect(isBidirectional(UP)).toBe(false);
  });

  it('names each combination for announcements', () => {
    expect(describeDirections(DOWN)).toBe('download');
    expect(describeDirections(UP)).toBe('upload');
    expect(describeDirections(BOTH)).toContain('together');
  });

  it('has a name for the empty pair rather than returning undefined', () => {
    expect(describeDirections({ down: false, up: false })).toBe('nothing');
  });
});
