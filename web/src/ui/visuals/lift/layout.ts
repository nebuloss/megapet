/**
 * The lift scene's layout.
 *
 * The needle turns a gear pair that is permanently in mesh, and that drives the
 * sheave through a belt. Crossing the belt reverses the sheave, which is the
 * whole trick: nothing ever meshes or unmeshes, so no part can be driven
 * through another, and the two directions travel at the same rate.
 */
import {
  fitTransform,
  gear,
  pulley,
  toRadians,
  type Bounds,
  type Gear,
  type Point,
  type Pulley,
  type Rect,
} from '../../../mech';

export const MODULE = 2.6;

/** Needle shaft, and the layshaft it drives. Always in mesh. */
export const HUB: Gear = gear(MODULE, 15, 140, 100);
export const LAY: Gear = gear(MODULE, 20, 97.24, 115.56);

/** Belt pulleys: equal, so open and crossed run at the same rate. */
export const DRIVE: Pulley = pulley(LAY.x, LAY.y, 14);
export const SHEAVE = { x: 140, y: 166, radius: 26 };
export const DRIVEN: Pulley = pulley(SHEAVE.x, SHEAVE.y, 14);

export const START_ANGLE = 225;
export const SWEEP = 270;
export const SWEEP_RAD = toRadians(SWEEP);

/** Needle turns to sheave turns: one gear mesh, then the belt at 1:1. */
export const DRIVE_RATIO = HUB.teeth / LAY.teeth;

export const DIAL = { radius: 68, width: 10, ringRadius: 77, labelRadius: 88 };
export const NEEDLE_LENGTH = 58;
export const ARC_LENGTH = 2 * Math.PI * DIAL.radius * (SWEEP / 360);
export const RING_LENGTH = 2 * Math.PI * DIAL.ringRadius * (SWEEP / 360);

/** Rope passed over the sheave by a full sweep of the needle. */
export const TRAVEL = DRIVE_RATIO * SWEEP_RAD * SHEAVE.radius;

// Tall rather than wide: the car cannot widen, because the counterweight hangs
// only 52 units away and that distance is fixed by the sheave's radius. Height
// was the binding constraint on Nookies anyway — he filled 85% of the old
// window vertically and 57% of it across.
export const CAR = { w: 60, h: 70, x: SHEAVE.x - SHEAVE.radius, top: 206 };
export const CAR_BOTTOM = CAR.top + TRAVEL;
export const WEIGHT = { w: 20, h: 38, x: SHEAVE.x + SHEAVE.radius, low: 300 };
export const SHAFT = { x: 74, y: 200, w: 118, h: 172 };

/** Spring-applied brake on the sheave: it holds while the belt is being shifted. */
export const BRAKE = { angle: -52, arm: 30, shoe: 5, lift: 4 };

/** The shifter fork that walks the belt across, on its own pivot beside the belt. */
export const FORK = { x: 86, y: 152, arm: 34, open: 0, crossed: 40 };
export const SHIFT_DRUM_R = 9;

/** Control rope from the car's lever, over a guide pulley, onto the fork's drum. */
export const PULLEY = { x: 84, y: 122, r: 5.5 };
export const ROPE_RUN_X = PULLEY.x - PULLEY.r;
export const ROPE_PIN_BASE = 200;

export const SPRING_ANCHOR: Point = { x: 52, y: 178 };
export const SPRING_PIN_R = 11;
export const SPRING_PIN_BASE = 120;

/** Detent holding the fork in either position. */
export const PAWL_ANGLE = -68;
export const PAWL_RADIUS = SHIFT_DRUM_R + 2.1;
export const PAWL_LIFT = 2.2;
export const PAWL_WIDTH = 8;

/** The lever in the car. Its arm and throw match the fork's drum exactly. */
export const FORK_TRAVEL = FORK.crossed - FORK.open;
export const LEVER = {
  x: 96,
  y: 19,
  handle: 13,
  arm: SHIFT_DRUM_R,
  seatUp: FORK_TRAVEL / 2,
  seatDown: -FORK_TRAVEL / 2,
};

/**
 * The extent Nookies occupies in his own coordinates — ear tips to feet,
 * including the arms. Measured from the drawing in `nookie.ts`; if that
 * changes shape, change this and nothing else.
 */
export const NOOKIE_BOUNDS: Bounds = { minX: -26, minY: -27, maxX: 26, maxY: 24 };

/** The window he rides behind, derived from the car rather than restated. */
export const CAR_WINDOW: Rect = {
  x: CAR.x - CAR.w / 2 + 7,
  y: 11,
  width: CAR.w - 14,
  height: CAR.h - 22,
};

/**
 * Where Nookies sits, solved from the window instead of hand-tuned.
 *
 * This is the point: resizing the car resizes and re-centres him, with no
 * second constant to keep in step and nothing that can quietly start
 * overflowing the glass. `maxScale` only stops a very large car inflating him
 * past his drawn proportions.
 */
export const NOOKIE = fitTransform(NOOKIE_BOUNDS, CAR_WINDOW, { padding: 1.5, maxScale: 1.1 });

/**
 * The throw, stage by stage. Slow on purpose: the belt walking across is the
 * thing worth watching, and the brake is on throughout so the car cannot move
 * while the drive is neither one thing nor the other.
 */
export const SHIFT_MS = 2600;
export const STAGE = {
  brake: [0.0, 0.12],
  reach: [0.14, 0.28],
  lever: [0.26, 0.46],
  cross: [0.34, 0.74],
  release: [0.64, 0.78],
  unbrake: [0.86, 1.0],
} as const;

export const EASE_TAU = 110;

/**
 * How long the needle takes to swing back to its stop between phases.
 *
 * Zeroing the reading is a scripted sweep, not a reading being tracked. At the
 * reading's own time constant a full-scale drop is 36 degrees in the first
 * frame and over in three, which reads as a reset rather than a needle.
 */
export const RETURN_MS = 900;

/** How long the machine takes to return the car to the top floor before a run. */
export const HOME_MS = 900;

/**
 * How long the car takes to finish its run into a floor when a phase ends.
 *
 * The car's height tracks the reading, so a 940 Mbps result on a scale that
 * goes to ten gigabits leaves it stopped three quarters of the way down. That
 * reads as an abandoned journey. When the phase ends the machine drives it the
 * rest of the way and levels it into the floor it was heading for.
 */
export const LAND_MS = 700;
