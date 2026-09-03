/** SVG path generation for the mechanism parts. */
import { distance, polar, TAU, wrapTau, type Point } from './geometry';
import { circularPitch, type Gear } from './gear';

function at(angle: number, radius: number): string {
  return `${(Math.cos(angle) * radius).toFixed(2)} ${(Math.sin(angle) * radius).toFixed(2)}`;
}

/**
 * A spur gear outline, centred on the origin.
 *
 * Tooth thickness is half the circular pitch at the pitch circle, wider at the
 * root and tapered at the tip, with an addendum of one module and a dedendum of
 * 1.25 — the proportions of a real cut tooth, which is why two of these mesh
 * with clearance instead of colliding.
 */
export function gearOutline(g: Gear, module: number): string {
  const pitch = circularPitch(g);
  const tip = g.radius + module;
  const root = g.radius - 1.25 * module;

  const parts: string[] = [`M ${at(-0.3 * pitch, root)}`];
  for (let i = 0; i < g.teeth; i++) {
    const centre = i * pitch;
    if (i > 0) parts.push(`A ${root} ${root} 0 0 1 ${at(centre - 0.3 * pitch, root)}`);
    parts.push(`L ${at(centre - 0.25 * pitch, g.radius)}`);
    parts.push(`L ${at(centre - 0.16 * pitch, tip)}`);
    parts.push(`A ${tip} ${tip} 0 0 1 ${at(centre + 0.16 * pitch, tip)}`);
    parts.push(`L ${at(centre + 0.25 * pitch, g.radius)}`);
    parts.push(`L ${at(centre + 0.3 * pitch, root)}`);
  }
  parts.push(`A ${root} ${root} 0 0 1 ${at(TAU - 0.3 * pitch, root)}`, 'Z');
  return parts.join(' ');
}

export interface SpringOptions {
  coils?: number;
  amplitude?: number;
}

/** A tension spring: a straight eye at each end, coils along the axis between. */
export function springOutline(a: Point, b: Point, options: SpringOptions = {}): string {
  const coils = options.coils ?? 9;
  const amplitude = options.amplitude ?? 3.2;
  const length = Math.max(1, distance(a, b));
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const lead = Math.min(6, length / 4);
  const span = length - 2 * lead;

  const parts = [`M ${a.x.toFixed(2)} ${a.y.toFixed(2)}`];
  for (let i = 1; i <= coils; i++) {
    const t = i / (coils + 1);
    const offset = (i % 2 === 0 ? 1 : -1) * amplitude;
    parts.push(
      `L ${(a.x + ux * (lead + span * t) - uy * offset).toFixed(2)} ` +
        `${(a.y + uy * (lead + span * t) + ux * offset).toFixed(2)}`,
    );
  }
  parts.push(`L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`);
  return parts.join(' ');
}

/** An arc of a circle, given the centre and the two end angles. */
export function arcOutline(
  centre: Point,
  radius: number,
  from: number,
  to: number,
  sweep: 0 | 1 = 1,
): string {
  const start = polar(centre, radius, from);
  const end = polar(centre, radius, to);
  const span = sweep === 1 ? wrapTau(to - from) : wrapTau(from - to);
  const large = span > Math.PI ? 1 : 0;
  return (
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} ` +
    `A ${radius} ${radius} 0 ${large} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
  );
}

/** Appends an arc to an existing path, from wherever it currently is. */
export function arcTo(centre: Point, radius: number, from: number, to: number, sweep: 0 | 1 = 1): string {
  const end = polar(centre, radius, to);
  const span = sweep === 1 ? wrapTau(to - from) : wrapTau(from - to);
  const large = span > Math.PI ? 1 : 0;
  return `A ${radius} ${radius} 0 ${large} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export function lineTo(p: Point): string {
  return `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
}

export function moveTo(p: Point): string {
  return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
}
