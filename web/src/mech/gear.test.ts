import { describe, expect, it } from 'vitest';
import { bearing, polar, TAU, toRadians } from './geometry';
import {
  circularPitch,
  engagementTakeUp,
  gear,
  maxTakeUp,
  meshDistance,
  meshError,
  meshPhase,
  meshRatio,
  pitchRadius,
  planetPhase,
  type Gear,
} from './gear';

const MODULE = 2.6;

describe('a common module', () => {
  it('gives every gear the same tooth size', () => {
    const a = gear(MODULE, 15, 0, 0);
    const b = gear(MODULE, 20, 66, 0);
    // Circular pitch measured on the pitch circle is the same for both.
    expect(circularPitch(a) * a.radius).toBeCloseTo(circularPitch(b) * b.radius);
  });

  it('derives the pitch radius from the tooth count', () => {
    expect(pitchRadius(MODULE, 15)).toBeCloseTo(19.5);
    expect(gear(MODULE, 20, 0, 0).radius).toBeCloseTo(26);
  });
});

describe('meshRatio', () => {
  it('is a tooth count, and negative because meshed gears counter-rotate', () => {
    const driver = gear(MODULE, 15, 0, 0);
    const driven = gear(MODULE, 10, 32.5, 0);
    expect(meshRatio(driver, driven)).toBeCloseTo(-1.5);
  });

  it('cancels through an idler, so an idler only sets direction', () => {
    const hub = gear(MODULE, 15, 0, 0);
    const idler = gear(MODULE, 10, 0, 0);
    const output = gear(MODULE, 20, 0, 0);
    const through = meshRatio(hub, idler) * meshRatio(idler, output);
    expect(through).toBeCloseTo(hub.teeth / output.teeth);
  });
});

describe('mesh indexing', () => {
  const a = gear(MODULE, 15, 0, 0);

  it('puts a tooth of one gear in a space of the other', () => {
    const b = gear(MODULE, 10, meshDistance(a, gear(MODULE, 10, 0, 0)), 0);
    const phase = meshPhase(a, 0.4, b);
    expect(meshError(a, 0.4, b, phase)).toBeCloseTo(0, 10);
  });

  it('holds at any line of centres', () => {
    for (const angle of [0, 0.9, 2.4, -1.7, Math.PI]) {
      const centre = polar({ x: 0, y: 0 }, 32.5, angle);
      const b: Gear = { ...gear(MODULE, 10, centre.x, centre.y) };
      const phase = meshPhase(a, 0.2, b);
      expect(meshError(a, 0.2, b, phase)).toBeCloseTo(0, 10);
      // The line of centres really is the direction we solved along.
      expect(bearing(a, b)).toBeCloseTo(angle);
    }
  });

  it('is periodic in whole teeth, so any tooth will do', () => {
    const b = gear(MODULE, 10, 32.5, 0);
    const phase = meshPhase(a, 0, b);
    expect(meshError(a, 0, b, phase + TAU / b.teeth)).toBeCloseTo(0, 10);
  });

  it('reports the offset when the mesh is wrong', () => {
    const b = gear(MODULE, 10, 32.5, 0);
    const phase = meshPhase(a, 0, b);
    // Half a tooth out is the worst case.
    expect(Math.abs(meshError(a, 0, b, phase + Math.PI / b.teeth))).toBeCloseTo(Math.PI);
  });
});

describe('engagementTakeUp', () => {
  const a = gear(MODULE, 10, 0, 0);
  const b = gear(MODULE, 20, 39, 0);

  it('is zero when the gears already mesh', () => {
    expect(engagementTakeUp(a, 0, b, meshPhase(a, 0, b))).toBeCloseTo(0, 10);
  });

  it('never exceeds half a tooth pitch', () => {
    for (let i = 0; i < 64; i++) {
      const phaseA = (i / 64) * TAU;
      const take = engagementTakeUp(a, phaseA, b, 0);
      expect(Math.abs(take)).toBeLessThanOrEqual(maxTakeUp(b) + 1e-9);
    }
  });

  it('is exactly the rotation that brings the pair into mesh', () => {
    const take = engagementTakeUp(a, 1.234, b, 0.5);
    expect(meshError(a, 1.234, b, 0.5 + take)).toBeCloseTo(0, 10);
  });
});

describe('planetPhase', () => {
  const hub = gear(MODULE, 15, 0, 0);
  const planet = gear(MODULE, 10, 0, 0);
  const arm = meshDistance(hub, planet);
  const centreAt = (yoke: number): Gear => {
    const p = polar(hub, arm, Math.PI / 2 + yoke);
    return { ...planet, x: p.x, y: p.y };
  };
  const constant = meshPhase(hub, 0, centreAt(0));

  it('keeps the planet meshed while the driver turns', () => {
    for (const hubPhase of [0, 0.7, 2.1, 4.7]) {
      const phase = planetPhase(hub, planet, hubPhase, 0, constant);
      expect(meshError(hub, hubPhase, centreAt(0), phase)).toBeCloseTo(0, 10);
    }
  });

  it('rolls the planet as the carrier swings, so it never slides', () => {
    for (const yoke of [0, 0.2, toRadians(24.9), toRadians(-54.86)]) {
      const phase = planetPhase(hub, planet, 0, yoke, constant);
      expect(meshError(hub, 0, centreAt(yoke), phase)).toBeCloseTo(0, 10);
    }
  });

  it('breaks if the carrier term is dropped, which is the bug it prevents', () => {
    const yoke = toRadians(-54.86);
    const sliding = -(hub.teeth / planet.teeth) * 0 + constant;
    expect(Math.abs(meshError(hub, 0, centreAt(yoke), sliding))).toBeGreaterThan(0.1);
  });
});
