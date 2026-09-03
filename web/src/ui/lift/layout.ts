/**
 * The lift scene's layout.
 *
 * Everything that can be derived is derived: the gear train comes from
 * `buildTumbler`, the yoke seats are solved from mesh distances, the rope
 * drum's pin is placed from the tangent it has to wrap to, and the return
 * spring's pin is seated for maximum extension. Only the artistic decisions —
 * where the shaft is, how big the car is — are literals.
 */
import {
  bearing,
  buildTumbler,
  seatSpringPin,
  seatTravel,
  swingCentre,
  tangentPoint,
  toDegrees,
  toRadians,
  type Gear,
  type Point,
  type Tumbler,
} from '../../mech';

export const MODULE = 2.6;

/** Hub on the needle shaft, traction sheave below it, reverse gear to the right. */
export const TRAIN: Tumbler = buildTumbler({
  module: MODULE,
  hub: { teeth: 15, at: { x: 140, y: 100 } },
  output: { teeth: 20, at: { x: 140, y: 166 } },
  swing: { teeth: 10 },
  reverse: { teeth: 9, x: 170, above: true },
});

export const HUB = TRAIN.hub;
export const SHEAVE = TRAIN.output;
export const REVERSE = TRAIN.reverse;
export const SWING_BASE: Gear = swingCentre(TRAIN, 0);

/** Yoke angles at which each seat meshes exactly, in degrees. */
export const YOKE_UP = TRAIN.seats.direct;
export const YOKE_DOWN = TRAIN.seats.reversed;
export const YOKE_TRAVEL = seatTravel(TRAIN);

export const START_ANGLE = 225;
export const SWEEP = 270;
export const SWEEP_RAD = toRadians(SWEEP);

export const DIAL = { radius: 68, width: 10, ringRadius: 77, labelRadius: 88 };
export const NEEDLE_LENGTH = 58;
export const ARC_LENGTH = 2 * Math.PI * DIAL.radius * (SWEEP / 360);
export const RING_LENGTH = 2 * Math.PI * DIAL.ringRadius * (SWEEP / 360);

/**
 * A full sweep of the needle passes `hub radius × angle` of rope over the
 * sheave: the gears between only set direction, so their counts cancel.
 */
export const TRAVEL = HUB.radius * SWEEP_RAD;

export const CAR = { w: 60, h: 56, x: SHEAVE.x - SHEAVE.radius, top: 212 };
export const CAR_BOTTOM = CAR.top + TRAVEL;
export const WEIGHT = { w: 20, h: 38, x: SHEAVE.x + SHEAVE.radius, low: 300 };
export const SHAFT = { x: 74, y: 200, w: 118, h: 172 };

/** Control rope: guide pulley, the drum on the yoke shaft, the return spring. */
export const PULLEY = { x: 84, y: 122, r: 5.5 };
export const ROPE_RUN_X = PULLEY.x - PULLEY.r;
export const SHIFT_DRUM_R = 9;

/** Where the rope lands on the drum, and how far it wraps before it is made off. */
export const ROPE_TANGENT: Point = tangentPoint(PULLEY, HUB, SHIFT_DRUM_R, 1);
const ROPE_TANGENT_DEG = toDegrees(bearing(HUB, ROPE_TANGENT));
const WRAP_AT_UP_DEG = 110;
export const ROPE_PIN_BASE = ROPE_TANGENT_DEG + WRAP_AT_UP_DEG - YOKE_UP;

export const SPRING_ANCHOR: Point = { x: 198, y: 76 };
export const SPRING_PIN_R = 11;
/** Seated so the spring is stretched in the download seat and returns to upload. */
export const SPRING_PIN_BASE = toDegrees(
  seatSpringPin(HUB, SPRING_PIN_R, SPRING_ANCHOR, toRadians(YOKE_DOWN), toRadians(YOKE_UP)),
);

/** Sprung detent holding the yoke in whichever seat it was thrown into. */
export const PAWL_ANGLE = -34.3;
export const PAWL_RADIUS = SHIFT_DRUM_R + 2.1;
export const PAWL_LIFT = 2.2;
export const PAWL_WIDTH = 7;

/**
 * The lever in the car. Its arm and throw match the drum's exactly, so the rope
 * it pays out is the rope the drum takes up — a 1:1 linkage that conserves
 * length instead of pretending to.
 */
export const LEVER = {
  x: 96,
  y: 19,
  handle: 13,
  arm: SHIFT_DRUM_R,
  seatUp: YOKE_TRAVEL / 2,
  seatDown: -YOKE_TRAVEL / 2,
};

/** Where Nookies sits in the car, and how far his waving arm reaches. */
export const NOOKIE = { x: CAR.x, y: 30, scale: 0.55 };

/** The throw, stage by stage, as fractions of `SHIFT_MS`. */
export const SHIFT_MS = 1500;
export const STAGE = {
  reach: [0.2, 0.34],
  lever: [0.32, 0.54],
  release: [0.46, 0.62],
  yoke: [0.58, 0.8],
  takeUp: [0.8, 0.93],
} as const;

/** Time constant of the reading's easing, in milliseconds. */
export const EASE_TAU = 110;
