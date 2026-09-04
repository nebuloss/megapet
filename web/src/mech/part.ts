/**
 * A machine is a tree of parts, and an assembly is itself a part.
 *
 * This is the composite half of the library; `drive.ts` is the other half. A
 * part answers one question — where am I now — and answers it by writing to a
 * `Scene`. It never touches the document, so the whole machine can be
 * assembled, driven and inspected in a test with no DOM at all, and the same
 * tree could be drawn to SVG, to a canvas, or to a list of numbers.
 *
 * Parts fall into two kinds, and it is worth knowing which you are holding:
 *
 * - a few **carry state** — the pointer's reading, the car's height, the
 *   fork's throw, the belt's direction. These are the machine.
 * - the rest are **derived** from those. The sheave's angle is the car's
 *   height over its radius; the brake, the detent, the spring and the
 *   operating lever are all the fork's throw; the counterweight is the car,
 *   inverted. A derived part stores nothing, so it cannot fall out of step
 *   with what it is derived from.
 */

/**
 * Where a part's position goes.
 *
 * The port between the machine and whatever draws it. Implemented once against
 * the DOM for the real visual and once as a recorder for tests, which is why
 * nothing in a part may reach for the browser.
 */
export interface Scene {
  /** Places a part: `translate(...)`, `rotate(...)`, any SVG transform. */
  transform(part: string, value: string): void;
  /** Reshapes a part that is drawn as a path. */
  path(part: string, d: string): void;
  /** Any other attribute a part sets on itself. */
  attr(part: string, name: string, value: string): void;
  /** A condition of the machine, for the stylesheet to respond to. */
  flag(name: string, on: boolean): void;
  /** A quantity the stylesheet reads, such as how hard the machine is working. */
  quantity(name: string, value: string): void;
}

/** Anything in the machine that can say where it is. */
export interface Part {
  /** What this is called, in the machine and in the drawing. */
  readonly name: string;
  /** Writes this part's current position into the scene. */
  place(scene: Scene): void;
}

/**
 * A part made of parts.
 *
 * Placing an assembly places everything in it, in order, so the whole machine
 * is drawn by asking its root to place itself once.
 */
export class Assembly implements Part {
  private readonly parts: Part[] = [];

  constructor(
    readonly name: string,
    ...parts: Part[]
  ) {
    this.parts.push(...parts);
  }

  add(...parts: Part[]): this {
    this.parts.push(...parts);
    return this;
  }

  place(scene: Scene): void {
    for (const part of this.parts) part.place(scene);
  }

  /** Every part below this one, assemblies included: a parts list, in order. */
  *walk(): Generator<Part> {
    for (const part of this.parts) {
      yield part;
      if (part instanceof Assembly) yield* part.walk();
    }
  }

  /** Finds a part by name, at any depth. */
  find(name: string): Part | undefined {
    for (const part of this.walk()) if (part.name === name) return part;
    return undefined;
  }
}

/**
 * A part whose position is a function of the machine's state.
 *
 * Most of a machine is this. It stores nothing, so there is nothing for it to
 * get out of step with — which is the entire reason the scene has four moving
 * numbers in it rather than sixty.
 */
export class Derived implements Part {
  constructor(
    readonly name: string,
    private readonly at: () => string,
    private readonly as: 'transform' | 'path' = 'transform',
  ) {}

  place(scene: Scene): void {
    if (this.as === 'path') scene.path(this.name, this.at());
    else scene.transform(this.name, this.at());
  }
}

/**
 * A part that says where it is by setting one attribute of itself.
 *
 * A rope drawn as a line ends wherever the thing it is tied to has got to, and
 * an arc drawn as a dash offset shows however much of itself the reading has
 * uncovered. Neither is a transform, and both are still just a part answering
 * the same question.
 */
export class Attribute implements Part {
  constructor(
    readonly name: string,
    private readonly attribute: string,
    private readonly at: () => string,
  ) {}

  place(scene: Scene): void {
    scene.attr(this.name, this.attribute, this.at());
  }
}

/** A condition of the machine, for the stylesheet to respond to. */
export class Flag implements Part {
  constructor(
    readonly name: string,
    private readonly on: () => boolean,
  ) {}

  place(scene: Scene): void {
    scene.flag(this.name, this.on());
  }
}

/** A quantity the stylesheet reads, such as how hard the machine is working. */
export class Quantity implements Part {
  constructor(
    readonly name: string,
    private readonly at: () => string,
  ) {}

  place(scene: Scene): void {
    scene.quantity(this.name, this.at());
  }
}

/** Records what a machine did, so a test can look at it without a document. */
export class RecordingScene implements Scene {
  readonly transforms = new Map<string, string>();
  readonly paths = new Map<string, string>();
  readonly attrs = new Map<string, string>();
  readonly flags = new Map<string, boolean>();
  readonly quantities = new Map<string, string>();

  transform(part: string, value: string): void {
    this.transforms.set(part, value);
  }

  path(part: string, d: string): void {
    this.paths.set(part, d);
  }

  attr(part: string, name: string, value: string): void {
    this.attrs.set(`${part}.${name}`, value);
  }

  flag(name: string, on: boolean): void {
    this.flags.set(name, on);
  }

  quantity(name: string, value: string): void {
    this.quantities.set(name, value);
  }

  /** Everything written, flattened and sorted: a comparable snapshot. */
  snapshot(): string {
    const lines: string[] = [];
    for (const [k, v] of this.transforms) lines.push(`transform ${k} ${v}`);
    for (const [k, v] of this.paths) lines.push(`path ${k} ${v}`);
    for (const [k, v] of this.attrs) lines.push(`attr ${k} ${v}`);
    for (const [k, v] of this.flags) lines.push(`flag ${k} ${v}`);
    for (const [k, v] of this.quantities) lines.push(`quantity ${k} ${v}`);
    return lines.sort().join('\n');
  }
}
