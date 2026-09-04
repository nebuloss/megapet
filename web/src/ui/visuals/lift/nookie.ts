/**
 * Nookies.
 *
 * The fur stays beige in both themes — a mascot that changes colour with the
 * palette stops being the same character — while the scarf takes the Material
 * You seed so he still belongs to the theme.
 */
import { clamp, lerp } from '../../../mech';
import { LEVER, NOOKIE } from './layout';

/** Shoulder and rest-pose hand, in Nookies' own coordinates. */
const SHOULDER = { x: -11, y: 4 };
const REST = { x: -12, y: -9 };
const ARM_LENGTH = Math.hypot(REST.x, REST.y);
const MAX_STRETCH = 1.25;

export function nookieMarkup(): string {
  return `
  <g class="nookie">
    <g class="nookie__arm nookie__arm--back">
      <path d="M11 4 q10 -1 12 -9"/>
      <circle class="nookie__paw" cx="23" cy="-5" r="2"/>
    </g>
    <ellipse class="nookie__ear" cx="-12" cy="-20" rx="6.6" ry="6.6"/>
    <ellipse class="nookie__ear" cx="12" cy="-20" rx="6.6" ry="6.6"/>
    <ellipse class="nookie__ear-inner" cx="-12" cy="-20" rx="3" ry="3"/>
    <ellipse class="nookie__ear-inner" cx="12" cy="-20" rx="3" ry="3"/>
    <rect class="nookie__torso" x="-14" y="-2" width="28" height="25" rx="11"/>
    <ellipse class="nookie__belly" cx="0" cy="12" rx="8" ry="8"/>
    <path class="nookie__scarf" d="M-13 -1 q13 7 26 0 v5 q-13 7 -26 0 z"/>
    <path class="nookie__scarf-tail" d="M9 3 q6 4 4 11 l-5 -1 q2 -6 -2 -9 z"/>
    <circle class="nookie__head" cx="0" cy="-10" r="15"/>
    <ellipse class="nookie__muzzle" cx="0" cy="-5" rx="8.2" ry="6.4"/>
    <ellipse class="nookie__nose" cx="0" cy="-8.4" rx="2.7" ry="2"/>
    <path class="nookie__mouth" d="M0 -6.6 v2 M0 -4.6 q-2.6 2.2 -4.6 0 M0 -4.6 q2.6 2.2 4.6 0"/>
    <g class="nookie__eyes">
      <ellipse cx="-6" cy="-13.5" rx="2" ry="2.4"/>
      <ellipse cx="6" cy="-13.5" rx="2" ry="2.4"/>
    </g>
    <ellipse class="nookie__blush" cx="-10" cy="-7" rx="3" ry="2"/>
    <ellipse class="nookie__blush" cx="10" cy="-7" rx="3" ry="2"/>
    <g class="nookie__arm nookie__arm--wave">
      <path d="M-11 4 q-10 -1 -12 -9"/>
      <circle class="nookie__paw" cx="-23" cy="-5" r="2"/>
    </g>
  </g>`;
}

/**
 * Points the waving arm at the lever handle while Nookies has hold of it, and
 * stretches it a little to close the gap — the oldest trick in character
 * animation, and invisible at this size. `grip` fades the whole pose in and out.
 */
export function armTransform(leverDegrees: number, grip: number): string {
  const a = (leverDegrees * Math.PI) / 180;
  const tipX = LEVER.x - LEVER.handle * Math.sin(a);
  const tipY = LEVER.y + LEVER.handle * Math.cos(a);
  const toHandle = {
    x: (tipX - NOOKIE.x) / NOOKIE.scale - SHOULDER.x,
    y: (tipY - NOOKIE.y) / NOOKIE.scale - SHOULDER.y,
  };
  const cross = REST.x * toHandle.y - REST.y * toHandle.x;
  const dot = REST.x * toHandle.x + REST.y * toHandle.y;
  const degrees = (Math.atan2(cross, dot) * 180) / Math.PI;
  const stretch = clamp(Math.hypot(toHandle.x, toHandle.y) / ARM_LENGTH, 1, MAX_STRETCH);
  return `rotate(${(degrees * grip).toFixed(2)}) scale(${lerp(1, stretch, grip).toFixed(3)})`;
}
