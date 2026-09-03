/** The scene's SVG. Everything that moves is given a class the scene can find. */
import { gearOutline, polar, toRadians, type Gear } from '../../mech';
import { TICKS, toFraction } from '../scale';
import { nookieMarkup } from './nookie';
import {
  ARC_LENGTH,
  CAR,
  DIAL,
  HUB,
  LEVER,
  MODULE,
  NEEDLE_LENGTH,
  NOOKIE,
  PAWL_ANGLE,
  PAWL_RADIUS,
  PULLEY,
  REVERSE,
  RING_LENGTH,
  ROPE_PIN_BASE,
  ROPE_RUN_X,
  SHAFT,
  SHEAVE,
  SHIFT_DRUM_R,
  SPRING_ANCHOR,
  SPRING_PIN_R,
  SPRING_PIN_BASE,
  START_ANGLE,
  SWEEP,
  SWING_BASE,
  WEIGHT,
  YOKE_DOWN,
  YOKE_UP,
} from './layout';

function gearGroup(name: string, g: Gear, inner = ''): string {
  const reach = (g.radius - 1.25 * MODULE - 2).toFixed(1);
  return `
  <g class="lift__gear lift__gear--${name}" transform="translate(${g.x.toFixed(2)} ${g.y.toFixed(2)})">
    <g class="lift__gear-spin">
      <path class="lift__gear-body" d="${gearOutline(g, MODULE)}"/>
      <path class="lift__gear-spoke" d="M0 -${reach}V${reach}M-${reach} 0H${reach}"/>
      ${inner}
    </g>
  </g>`;
}

function dialArc(radius: number): string {
  const from = polar(HUB, radius, toRadians(START_ANGLE - 90));
  const to = polar(HUB, radius, toRadians(START_ANGLE + SWEEP - 90));
  return (
    `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} ` +
    `A ${radius} ${radius} 0 1 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
  );
}

export function liftMarkup(clipId: string): string {
  const dialTicks = TICKS.map(([value, label]) => {
    const angle = toRadians(START_ANGLE + toFraction(value) * SWEEP - 90);
    const inner = polar(HUB, DIAL.radius - DIAL.width / 2 - 3, angle);
    const outer = polar(HUB, DIAL.radius - DIAL.width / 2 - 9, angle);
    const text = polar(HUB, DIAL.labelRadius, angle);
    return (
      `<line class="lift__dial-tick" x1="${inner.x.toFixed(1)}" y1="${inner.y.toFixed(1)}" x2="${outer.x.toFixed(1)}" y2="${outer.y.toFixed(1)}"/>` +
      `<text class="lift__dial-label" x="${text.x.toFixed(1)}" y="${(text.y + 3.2).toFixed(1)}">${label}</text>`
    );
  }).join('');

  const floors = [1, 2, 3, 4, 5]
    .map((k) => {
      const y = (SHAFT.y + (SHAFT.h * k) / 6).toFixed(1);
      return `<line class="lift__floor" x1="${SHAFT.x + 6}" y1="${y}" x2="${SHAFT.x + SHAFT.w - 6}" y2="${y}"/>`;
    })
    .join('');

  const streaks = [86, 100, 128, 176]
    .map(
      (x, i) =>
        `<line class="lift__streak" x1="${x}" y1="-26" x2="${x}" y2="8" style="animation-delay:${(i * 0.19).toFixed(2)}s"/>`,
    )
    .join('');

  // Detent notches, cut into the drum where the pawl meets it at each seat.
  const notches = [YOKE_UP, YOKE_DOWN]
    .map((seat) => {
      const p = polar({ x: 0, y: 0 }, SHIFT_DRUM_R, toRadians(PAWL_ANGLE - seat));
      return `<circle class="lift__detent-notch" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="2"/>`;
    })
    .join('');

  const ropePin = polar(HUB, SHIFT_DRUM_R, toRadians(ROPE_PIN_BASE));
  const springPin = polar(HUB, SPRING_PIN_R, toRadians(SPRING_PIN_BASE));
  const pawlRoller = polar(HUB, PAWL_RADIUS, toRadians(PAWL_ANGLE));
  const pawlTail = polar(HUB, 27, toRadians(PAWL_ANGLE));
  const pawlNeck = polar(HUB, PAWL_RADIUS + 2.2, toRadians(PAWL_ANGLE));

  return `
<svg viewBox="0 0 280 384" class="lift__svg" role="img"
     aria-label="A speed dial geared to a lift through a tumbler reverse: Nookies the bear pulls a lever whose rope throws the gearbox, sending the car down for download and up for upload">
  <defs>
    <clipPath id="${clipId}">
      <rect x="${SHAFT.x + 2}" y="${SHAFT.y + 2}" width="${SHAFT.w - 4}" height="${SHAFT.h - 4}" rx="10"/>
    </clipPath>
  </defs>

  <path class="lift__dial-track" d="${dialArc(DIAL.radius)}" stroke-width="${DIAL.width}"/>
  <path class="lift__dial-value" d="${dialArc(DIAL.radius)}" stroke-width="${DIAL.width}"
        stroke-dasharray="${ARC_LENGTH.toFixed(2)} ${ARC_LENGTH.toFixed(2)}"
        stroke-dashoffset="${ARC_LENGTH.toFixed(2)}"/>
  <path class="lift__progress-ring" d="${dialArc(DIAL.ringRadius)}" stroke-width="2.5"
        stroke-dasharray="${RING_LENGTH.toFixed(2)} ${RING_LENGTH.toFixed(2)}"
        stroke-dashoffset="${RING_LENGTH.toFixed(2)}"/>
  ${dialTicks}

  <rect class="lift__shaft-fill" x="${SHAFT.x}" y="${SHAFT.y}" width="${SHAFT.w}" height="${SHAFT.h}" rx="12"/>
  <g clip-path="url(#${clipId})">
    <g class="lift__streaks">${streaks}</g>
    ${floors}
    <path class="lift__rail" d="M82 ${SHAFT.y + 6}V${SHAFT.y + SHAFT.h - 6}M184 ${SHAFT.y + 6}V${SHAFT.y + SHAFT.h - 6}"/>
    <path class="lift__pit" d="M${SHAFT.x} ${SHAFT.y + SHAFT.h - 14}h${SHAFT.w}v14h-${SHAFT.w}z"/>
  </g>
  <rect class="lift__shaft-frame" x="${SHAFT.x}" y="${SHAFT.y}" width="${SHAFT.w}" height="${SHAFT.h}" rx="12"/>

  ${gearGroup('sheave', SHEAVE, `<circle class="lift__gear-hub" r="6"/><circle class="lift__sheave-groove" r="${(SHEAVE.radius - 4).toFixed(1)}"/>`)}
  <path class="lift__cable" d="M${CAR.x} ${SHEAVE.y} A ${SHEAVE.radius} ${SHEAVE.radius} 0 0 1 ${WEIGHT.x} ${SHEAVE.y}"/>
  <line class="lift__cable lift__cable--car" x1="${CAR.x}" y1="${SHEAVE.y}" x2="${CAR.x}" y2="${CAR.top}"/>
  <line class="lift__cable lift__cable--weight" x1="${WEIGHT.x}" y1="${SHEAVE.y}" x2="${WEIGHT.x}" y2="${WEIGHT.low}"/>

  <g class="lift__weight" transform="translate(0 ${WEIGHT.low})">
    <rect class="lift__weight-body" x="${WEIGHT.x - WEIGHT.w / 2}" y="0" width="${WEIGHT.w}" height="${WEIGHT.h}" rx="3"/>
    <path class="lift__weight-plates" d="M${WEIGHT.x - 6} 10h12M${WEIGHT.x - 6} 19h12M${WEIGHT.x - 6} 28h12"/>
  </g>

  <g class="lift__car" transform="translate(0 ${CAR.top})">
    <path class="lift__hook" d="M${CAR.x} -6v6M${CAR.x - 6} 0h12"/>
    <rect class="lift__car-roof" x="${CAR.x - CAR.w / 2 - 3}" y="0" width="${CAR.w + 6}" height="6" rx="3"/>
    <rect class="lift__car-body" x="${CAR.x - CAR.w / 2}" y="5" width="${CAR.w}" height="${CAR.h - 5}" rx="8"/>
    <rect class="lift__car-window" x="${CAR.x - CAR.w / 2 + 7}" y="11" width="${CAR.w - 14}" height="34" rx="6"/>
    <path class="lift__car-lamp" d="M${CAR.x - 4} 13h8"/>
    <path class="lift__bracket" d="M${CAR.x - CAR.w / 2} 14H${ROPE_RUN_X.toFixed(1)}"/>
    <circle class="lift__lever-mount" cx="${LEVER.x}" cy="${LEVER.y}" r="2.6"/>
    <g class="lift__lever" transform="rotate(${LEVER.seatUp.toFixed(2)} ${LEVER.x} ${LEVER.y})">
      <path class="lift__lever-tail" d="M${LEVER.x} ${LEVER.y}V${LEVER.y - LEVER.arm}"/>
      <circle class="lift__lever-pin" cx="${LEVER.x}" cy="${LEVER.y - LEVER.arm}" r="1.8"/>
      <path class="lift__lever-arm" d="M${LEVER.x} ${LEVER.y}V${LEVER.y + LEVER.handle}"/>
      <circle class="lift__lever-knob" cx="${LEVER.x}" cy="${LEVER.y + LEVER.handle}" r="2.7"/>
    </g>
    <g transform="translate(${NOOKIE.x} ${NOOKIE.y}) scale(${NOOKIE.scale})">${nookieMarkup()}</g>
    <path class="lift__car-floor" d="M${CAR.x - CAR.w / 2 + 5} 48h${CAR.w - 10}"/>
  </g>

  <path class="lift__spring"/>
  <circle class="lift__spring-anchor" cx="${SPRING_ANCHOR.x}" cy="${SPRING_ANCHOR.y}" r="3"/>
  <path class="lift__rope"/>
  <circle class="lift__pulley" cx="${PULLEY.x}" cy="${PULLEY.y}" r="${PULLEY.r}"/>
  <circle class="lift__pulley-hub" cx="${PULLEY.x}" cy="${PULLEY.y}" r="1.8"/>

  ${gearGroup('reverse', REVERSE, `<circle class="lift__gear-hub" r="3.8"/>`)}

  <g class="lift__yoke" transform="rotate(${YOKE_UP.toFixed(2)} ${HUB.x} ${HUB.y})">
    <path class="lift__yoke-arm" d="M${HUB.x} ${HUB.y}V${SWING_BASE.y.toFixed(2)}"/>
    ${gearGroup('swing', SWING_BASE, `<circle class="lift__gear-hub" r="4"/>`)}
  </g>

  ${gearGroup('hub', HUB, `<path class="lift__needle" d="M-3.4 0 L0 -${NEEDLE_LENGTH} L3.4 0 Z"/>`)}

  <g class="lift__shifter" transform="rotate(${YOKE_UP.toFixed(2)} ${HUB.x} ${HUB.y})">
    <circle class="lift__shift-drum" cx="${HUB.x}" cy="${HUB.y}" r="${SHIFT_DRUM_R}"/>
    <g transform="translate(${HUB.x} ${HUB.y})">${notches}</g>
    <circle class="lift__rope-pin" cx="${ropePin.x.toFixed(2)}" cy="${ropePin.y.toFixed(2)}" r="2"/>
    <circle class="lift__spring-pin" cx="${springPin.x.toFixed(2)}" cy="${springPin.y.toFixed(2)}" r="2"/>
  </g>

  <g class="lift__pawl">
    <path class="lift__pawl-spring" d="M${pawlTail.x.toFixed(1)} ${pawlTail.y.toFixed(1)}L${pawlNeck.x.toFixed(1)} ${pawlNeck.y.toFixed(1)}"/>
    <circle class="lift__pawl-roller" cx="${pawlRoller.x.toFixed(2)}" cy="${pawlRoller.y.toFixed(2)}" r="2.1"/>
  </g>
  <circle class="lift__needle-cap" cx="${HUB.x}" cy="${HUB.y}" r="4"/>
</svg>`;
}
