import { describe, expect, it } from 'vitest';
import { LEVER } from './layout';
import { armPose, nookieMarkup } from './nookie';

/**
 * The stretch `armTransform` is willing to apply. Kept in step with the
 * constant in `nookie.ts`, which is private because nothing else should be
 * choosing how far a bear's arm may be pulled.
 */
const MAX_STRETCH = 1.25;

/** The lever's two seats, and a sample of the throw between them. */
function throwSamples(): number[] {
  const steps = [];
  for (let i = 0; i <= 10; i++) {
    steps.push(LEVER.seatDown + ((LEVER.seatUp - LEVER.seatDown) * i) / 10);
  }
  return steps;
}

describe('the arm that throws the lever', () => {
  it('reaches the handle everywhere in the throw', () => {
    for (const degrees of throwSamples()) {
      expect(armPose(degrees).reach).toBeLessThanOrEqual(MAX_STRETCH);
    }
  });

  // Redrawing him is the thing that breaks the reach, and it breaks silently:
  // the paw simply stops short of the handle by a couple of units, which no
  // other test notices and which is hard to see at the size this is drawn.
  it('does not need to stretch at all at one of the two seats', () => {
    const seats = [armPose(LEVER.seatDown).reach, armPose(LEVER.seatUp).reach];
    expect(Math.min(...seats)).toBeLessThanOrEqual(1);
  });

  it('swings rather than windmills', () => {
    for (const degrees of throwSamples()) {
      expect(Math.abs(armPose(degrees).degrees)).toBeLessThan(90);
    }
  });
});

describe('the drawing', () => {
  it('keeps every part the stylesheet paints', () => {
    const markup = nookieMarkup();
    for (const cls of [
      'nookie__ear',
      'nookie__ear-inner',
      'nookie__torso',
      'nookie__belly',
      'nookie__foot',
      'nookie__foot-pad',
      'nookie__head',
      'nookie__muzzle',
      'nookie__nose',
      'nookie__mouth',
      'nookie__brows',
      'nookie__eyes',
      'nookie__arm--back',
      'nookie__arm--wave',
      'nookie__paw',
    ]) {
      expect(markup).toContain(cls);
    }
  });
});
