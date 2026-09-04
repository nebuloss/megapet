/**
 * The lift's scene, drawn into SVG.
 *
 * This is the only object in the machine that knows what an element is. Parts
 * name themselves and say where they are; this resolves those names, once, to
 * the elements that stand for them, and writes the answer down. Everything
 * else — the pointer, the drive train, the reversing gear, the hoist — can
 * then be assembled and driven with no document anywhere near it, which is why
 * the same machine can be recorded into a `RecordingScene` in a test.
 */
import type { Scene } from '../../../../mech';

/** What each part is called, and which element in the drawing stands for it. */
const ELEMENTS = {
  car: '.lift__car',
  weight: '.lift__weight',
  carRope: '.lift__cable--car',
  weightRope: '.lift__cable--weight',
  beltA: '.lift__belt--a',
  beltB: '.lift__belt--b',
  shifter: '.lift__shifter',
  brakeShoe: '.lift__brake-shoe-group',
  lever: '.lift__lever',
  rope: '.lift__rope',
  spring: '.lift__spring',
  pawl: '.lift__pawl',
  hub: '.lift__gear--hub .lift__gear-spin',
  lay: '.lift__gear--lay .lift__gear-spin',
  sheave: '.lift__sheave-spin',
  valueArc: '.lift__dial-value',
  ringArc: '.lift__progress-ring',
  arm: '.nookie__arm--wave',
} as const;

/**
 * Parts placed through the style property rather than the transform attribute.
 *
 * The bear's arm shares its transform with a CSS animation, and an attribute
 * and a stylesheet cannot both own one: the attribute is the weaker of the
 * two, so the keyframes would simply paint over it.
 */
const STYLED = new Set<string>(['arm']);

export class SvgScene implements Scene {
  private readonly elements = new Map<string, SVGElement>();

  constructor(
    private readonly root: HTMLElement,
    svg: SVGSVGElement,
  ) {
    for (const [name, selector] of Object.entries(ELEMENTS)) {
      this.elements.set(name, svg.querySelector<SVGElement>(selector)!);
    }
  }

  transform(part: string, value: string): void {
    const element = this.elements.get(part);
    if (!element) return;
    if (STYLED.has(part)) element.style.transform = value;
    else element.setAttribute('transform', value);
  }

  path(part: string, d: string): void {
    this.elements.get(part)?.setAttribute('d', d);
  }

  attr(part: string, name: string, value: string): void {
    this.elements.get(part)?.setAttribute(name, value);
  }

  /** A condition of the machine, for the stylesheet to respond to. */
  flag(name: string, on: boolean): void {
    this.root.dataset[name] = String(on);
  }

  /** A quantity the stylesheet reads, as a custom property on the figure. */
  quantity(name: string, value: string): void {
    this.root.style.setProperty(`--${name}`, value);
  }
}
