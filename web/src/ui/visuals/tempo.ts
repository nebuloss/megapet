/**
 * Every duration the machine moves on, in one place.
 *
 * These were spread across two files and tuned one at a time, which made
 * "slow the transitions down" a question about which of seven constants was
 * meant. They are together now, each named for the movement you would point at
 * on screen, and `TEMPO` scales all of them at once so the relationships
 * between them cannot drift apart while one is adjusted.
 *
 * Those relationships matter. The car is held for a landing plus a throw, and
 * the pointer's fall turns the sheave through the belt, so the hold has to
 * outlast the fall or the car is dragged back up the shaft. Scaling everything
 * together keeps that true by construction; `machine.test.ts` asserts it.
 */

/** Scales every duration below. Raise it to slow the whole machine down. */
export const TEMPO = 1;

const beat = (ms: number): number => Math.round(ms * TEMPO);

/** The pointer crossing the whole dial, and falling back to its stop. */
export const SWEEP_MS = beat(1600);

/** Walking the belt across: the reversal, and the thing you are meant to watch. */
export const SHIFT_MS = beat(3900);

/** A leg finishing its run into the floor it was heading for. */
export const LAND_MS = beat(1000);

/** A full-shaft journey at lift speed. Shorter trips take proportionally less. */
export const RIDE_FULL_MS = beat(2400);

/** The shortest journey worth making, so nothing is instant. */
export const RIDE_MIN_MS = beat(300);

/** Homing to the ground floor before a run. */
export const HOME_MS = beat(900);

/** The pointer's shortest fall, so a needle near the stop still swings. */
export const SWEEP_MIN_MS = beat(200);

/** Quiet after a reversal, before the next phase starts loading the link. */
export const SETTLE_MS = beat(250);
