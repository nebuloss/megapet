/**
 * Nookies, drawn from the plush he is: a squat cream bear, head low and
 * overlapping a body wider than it is tall, ear nubs barely clearing the
 * crown, stitched brows over small brown eyes, and big splayed feet instead of
 * legs. Those proportions are the likeness; getting them wrong reads as a
 * generic teddy however good the details are.
 *
 * The proportions are measured off a photograph of him rather than judged by
 * eye, because the head is the easy thing to get wrong: his is small for a
 * teddy, about 0.39 of his standing height across, and drawn any larger the
 * whole silhouette turns cartoon.
 *
 * He is cream in both themes and takes nothing from the palette. A mascot that
 * changes colour with the seed stops being the same character, and he is the
 * one part of this scene that is a likeness rather than a diagram.
 *
 * His arms are not a mirrored pair. The far one hangs as the plush's does; the
 * near one is raised because it has work to do — it waves, and it throws the
 * lever. Posing both down would cost the gesture and put the hand a long way
 * from the handle.
 */
import { clamp, lerp } from '../../../mech';
import { LEVER, NOOKIE } from './layout';

/** Shoulder and rest-pose hand, in Nookies' own coordinates. */
const SHOULDER = { x: -11, y: 4 };
const REST = { x: -14, y: -10 };
const ARM_LENGTH = Math.hypot(REST.x, REST.y);
const MAX_STRETCH = 1.25;

export function nookieMarkup(): string {
  return `
  <g class="nookie">
    <g class="nookie__arm nookie__arm--back">
      <path d="M14 1 q9 5 10 15"/>
      <circle class="nookie__paw" cx="24" cy="16" r="2.8"/>
    </g>
    <ellipse class="nookie__ear" cx="-8.4" cy="-23.5" rx="4.5" ry="4.5"/>
    <ellipse class="nookie__ear" cx="8.4" cy="-23.5" rx="4.5" ry="4.5"/>
    <ellipse class="nookie__ear-inner" cx="-9.2" cy="-24.3" rx="1.9" ry="1.9"/>
    <ellipse class="nookie__ear-inner" cx="9.2" cy="-24.3" rx="1.9" ry="1.9"/>
    <path class="nookie__torso" d="M0 -9.5 c11.5 0 19.5 7.5 20 17 c0.5 10.5 -4.8 18 -20 18 c-15.2 0 -20.5 -7.5 -20 -18 c0.5 -9.5 8.5 -17 20 -17 z"/>
    <ellipse class="nookie__belly" cx="0" cy="14" rx="11.5" ry="9.5"/>
    <g class="nookie__feet">
      <ellipse class="nookie__foot" cx="-11" cy="25" rx="7.8" ry="5.4" transform="rotate(-14 -11 25)"/>
      <ellipse class="nookie__foot-pad" cx="-11" cy="25.5" rx="4" ry="2.7" transform="rotate(-14 -11 25)"/>
      <ellipse class="nookie__foot" cx="11" cy="25" rx="7.8" ry="5.4" transform="rotate(14 11 25)"/>
      <ellipse class="nookie__foot-pad" cx="11" cy="25.5" rx="4" ry="2.7" transform="rotate(14 11 25)"/>
    </g>
    <circle class="nookie__head" cx="0" cy="-13" r="14"/>
    <ellipse class="nookie__muzzle" cx="0" cy="-8.1" rx="6.4" ry="5.3"/>
    <path class="nookie__nose" d="M-3.1 -13.1 q3.1 -1.7 6.4 0 q0.6 3.7 -3.1 4.9 q-3.7 -1.3 -3.1 -4.9 z"/>
    <path class="nookie__mouth" d="M0 -8.7 v3 M-6.8 -8 q6.8 4.6 13.7 0"/>
    <path class="nookie__brows" d="M-8.8 -18.8 q3.1 -1.7 5.9 -0.6 M8.8 -18.8 q-3.1 -1.7 -5.9 -0.6"/>
    <g class="nookie__eyes">
      <ellipse cx="-5.6" cy="-15.4" rx="1.76" ry="1.96"/>
      <ellipse cx="5.6" cy="-15.4" rx="1.76" ry="1.96"/>
    </g>
    <g class="nookie__arm nookie__arm--wave">
      <path d="M-11 4 q-11 -1 -14 -10"/>
      <circle class="nookie__paw" cx="-25" cy="-6" r="2.8"/>
    </g>
  </g>`;
}

/** How far the arm must swing and stretch to put the paw on the handle. */
export interface ArmPose {
  /** Rotation from the rest pose, in degrees. */
  readonly degrees: number;
  /**
   * Multiple of the arm's own length the handle sits at, **unclamped**.
   *
   * Above `MAX_STRETCH` the paw cannot reach and stops short of the handle,
   * which is why `nookie.test.ts` checks it across the lever's whole throw. It
   * is easy to break by redrawing the arm: the reach the drawing has to cover
   * is set by where he sits in the car, not by how long his arm happens to be.
   */
  readonly reach: number;
}

/** Solves the arm for a lever position, without deciding what is possible. */
export function armPose(leverDegrees: number): ArmPose {
  const a = (leverDegrees * Math.PI) / 180;
  const tipX = LEVER.x - LEVER.handle * Math.sin(a);
  const tipY = LEVER.y + LEVER.handle * Math.cos(a);
  const toHandle = {
    x: (tipX - NOOKIE.x) / NOOKIE.scale - SHOULDER.x,
    y: (tipY - NOOKIE.y) / NOOKIE.scale - SHOULDER.y,
  };
  const cross = REST.x * toHandle.y - REST.y * toHandle.x;
  const dot = REST.x * toHandle.x + REST.y * toHandle.y;
  return {
    degrees: (Math.atan2(cross, dot) * 180) / Math.PI,
    reach: Math.hypot(toHandle.x, toHandle.y) / ARM_LENGTH,
  };
}

/**
 * Points the waving arm at the lever handle while Nookies has hold of it, and
 * stretches it a little to close the gap — the oldest trick in character
 * animation, and invisible at this size. `grip` fades the whole pose in and out.
 */
export function armTransform(leverDegrees: number, grip: number): string {
  const { degrees, reach } = armPose(leverDegrees);
  const stretch = clamp(reach, 1, MAX_STRETCH);
  return `rotate(${(degrees * grip).toFixed(2)}) scale(${lerp(1, stretch, grip).toFixed(3)})`;
}
