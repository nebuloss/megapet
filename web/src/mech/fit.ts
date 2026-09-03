/** Fitting a drawing into the box it has to live in. */

/** An axis-aligned extent, in the coordinates of whatever it describes. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A translate-then-scale placement, in the order an SVG transform applies it. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export interface FitOptions {
  /** Space to leave inside the rect, on every side. */
  readonly padding?: number;
  /** Refuse to enlarge past this, so small content is not blown up. */
  readonly maxScale?: number;
}

export function boundsWidth(b: Bounds): number {
  return b.maxX - b.minX;
}

export function boundsHeight(b: Bounds): number {
  return b.maxY - b.minY;
}

/**
 * Scales and centres `content` inside `into`.
 *
 * The point is that a part positions itself from the box it occupies, rather
 * than from constants someone worked out by hand once. Resize the box and the
 * content follows; there is nothing left to forget to update, and nothing that
 * can silently start overflowing.
 */
export function fitTransform(content: Bounds, into: Rect, options: FitOptions = {}): Placement {
  const width = boundsWidth(content);
  const height = boundsHeight(content);
  if (width <= 0 || height <= 0) {
    throw new RangeError('fitTransform: content has no extent');
  }

  const padding = options.padding ?? 0;
  const available = {
    width: Math.max(0, into.width - 2 * padding),
    height: Math.max(0, into.height - 2 * padding),
  };

  let scale = Math.min(available.width / width, available.height / height);
  if (options.maxScale !== undefined) scale = Math.min(scale, options.maxScale);

  // Put the content's centre on the rect's centre. Because an SVG transform
  // applies the translate after the scale, the offset is the rect centre minus
  // the scaled content centre.
  return {
    x: into.x + into.width / 2 - ((content.minX + content.maxX) / 2) * scale,
    y: into.y + into.height / 2 - ((content.minY + content.maxY) / 2) * scale,
    scale,
  };
}

/** Where `content` lands once `placement` is applied. Useful for assertions. */
export function placedBounds(content: Bounds, placement: Placement): Bounds {
  return {
    minX: placement.x + content.minX * placement.scale,
    minY: placement.y + content.minY * placement.scale,
    maxX: placement.x + content.maxX * placement.scale,
    maxY: placement.y + content.maxY * placement.scale,
  };
}

/** Whether `content`, once placed, sits entirely inside `rect`. */
export function fitsInside(content: Bounds, placement: Placement, rect: Rect): boolean {
  const placed = placedBounds(content, placement);
  return (
    placed.minX >= rect.x - 1e-9 &&
    placed.minY >= rect.y - 1e-9 &&
    placed.maxX <= rect.x + rect.width + 1e-9 &&
    placed.maxY <= rect.y + rect.height + 1e-9
  );
}
