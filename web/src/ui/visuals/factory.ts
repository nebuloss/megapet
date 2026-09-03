import type { Preferences } from '../../core';
import { DialVisual } from './dial';
import { LiftVisual } from './lift/lift';
import type { SpeedVisual } from './visual';

/** The visuals a visitor can choose between. */
export type VisualKind = 'lift' | 'dial';

export interface VisualDescriptor {
  readonly kind: VisualKind;
  readonly label: string;
  readonly description: string;
  /** Constructs a fresh instance. */
  readonly create: () => SpeedVisual;
}

/**
 * The registry of hero visuals.
 *
 * Both entries satisfy `SpeedVisual`, so the rest of the app drives whichever
 * is mounted without knowing which it is — the interface is the seam, and this
 * table is the only place that names the concrete classes. Adding a third
 * visual means one more entry here and nothing else.
 */
export const VISUALS: readonly VisualDescriptor[] = [
  {
    kind: 'lift',
    label: 'Nookies lift',
    description: 'A speed dial geared to a lift',
    create: () => new LiftVisual(),
  },
  {
    kind: 'dial',
    label: 'Plain dial',
    description: 'Just the circular gauge',
    create: () => new DialVisual(),
  },
];

const DEFAULT_KIND: VisualKind = 'lift';
const KINDS = VISUALS.map((v) => v.kind);

/** Creates a visual, falling back to the default for an unknown kind. */
export function createVisual(kind: VisualKind): SpeedVisual {
  const descriptor = VISUALS.find((v) => v.kind === kind) ?? VISUALS[0]!;
  return descriptor.create();
}

/** Reads the stored preference, tolerating anything unexpected. */
export function readVisualKind(preferences: Preferences): VisualKind {
  return preferences.getOneOf('visual', KINDS, DEFAULT_KIND);
}
