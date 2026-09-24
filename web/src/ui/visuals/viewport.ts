/**
 * What part of a session the graph is showing.
 *
 * Three separate ideas, kept separate because conflating them is what makes
 * this sort of control confusing:
 *
 *  - **Zoom** is how much time fits across the plot. It has a default, so a
 *    long session is read at a fixed, legible precision and scrolls past
 *    rather than being squeezed into the width until every feature is a pixel
 *    wide.
 *  - **Pan** is where that window sits. Only meaningful once you have stopped
 *    following the live edge.
 *  - **Focus** is whether the window follows the newest reading. It is *not*
 *    the same as being zoomed out: you can be zoomed right in and still
 *    following, and zoomed out and parked over something that happened five
 *    minutes ago.
 *
 * Panning turns focus off, because dragging the graph away from the live edge
 * and having it snap back is the single most irritating thing a live chart
 * can do. Turning focus back on returns to the edge without changing the
 * zoom.
 */

/** Time across the plot when nothing has been chosen: readable, not total. */
export const DEFAULT_SPAN_MS = 30_000;

/** Closest zoom: any tighter and a one-second sample is most of the width. */
export const MIN_SPAN_MS = 5_000;

/** Furthest zoom, so a long session cannot be flattened into nothing. */
export const MAX_SPAN_MS = 6 * 60 * 60 * 1000;

/**
 * Share of the width left empty ahead of the newest reading while following.
 *
 * Drawn hard against the right edge the line has nowhere to arrive: each new
 * point appears already clipped, and the round cap that should show it
 * landing is half outside the plot.
 */
const HEADROOM = 0.08;

/** Where the newest reading sits across the plot while focused, 0..1. */
export const LEAD_POSITION = 1 - HEADROOM;

export interface Window {
  readonly fromMs: number;
  readonly toMs: number;
}

export class GraphViewport {
  private span = DEFAULT_SPAN_MS;
  /** Left edge, in session time. Only consulted when not following. */
  private anchor = 0;
  private following = true;

  get spanMs(): number {
    return this.span;
  }

  get isFocused(): boolean {
    return this.following;
  }

  /**
   * Follows the live edge again, or stops following.
   *
   * Turning it on deliberately leaves the zoom alone: "show me what is
   * happening now" and "show me more at once" are different requests.
   */
  setFocus(on: boolean): void {
    this.following = on;
  }

  /**
   * Multiplies the visible span. `factor` above 1 zooms out.
   *
   * `at` is where to keep still, 0..1 across the plot — the pointer under a
   * wheel, or the middle for a button. Without it, zooming would walk the
   * thing you were looking at off the edge.
   */
  zoom(factor: number, newestMs: number, at = 0.5): void {
    const current = this.window(newestMs);
    const held = current.fromMs + (current.toMs - current.fromMs) * at;
    // Never wider than the session itself. Zooming out past the beginning
    // buys empty axis and shrinks the only part there is anything to see in.
    const next = clampSpan(this.span * factor, newestMs);
    if (next === this.span) return;
    this.span = next;
    if (this.following) return;
    // Keep `held` under the same fraction of the plot it was under before.
    this.anchor = Math.max(0, held - next * at);
  }

  /** Slides the window. Any pan stops it following the live edge. */
  pan(deltaMs: number, newestMs: number): void {
    const current = this.window(newestMs);
    this.following = false;
    // Bounded at both ends: the session has a beginning, and scrolling past
    // the newest reading into blank future is never what anyone wanted.
    const furthest = Math.max(0, newestMs - this.span * LEAD_POSITION);
    this.anchor = Math.min(furthest, Math.max(0, current.fromMs + deltaMs));
  }

  /** Zooms out far enough to hold the whole session, and stops following. */
  fit(oldestMs: number, newestMs: number): void {
    this.span = clampSpan(Math.max(MIN_SPAN_MS, newestMs - oldestMs), newestMs);
    this.anchor = Math.max(0, oldestMs);
    this.following = false;
  }

  /** Back to the default zoom, following the live edge. */
  reset(): void {
    this.span = DEFAULT_SPAN_MS;
    this.anchor = 0;
    this.following = true;
  }

  /** The stretch of session time to draw. */
  window(newestMs: number): Window {
    if (this.following) {
      // The newest reading sits at LEAD_POSITION whatever the session's age,
      // so the window is always exactly one span wide and data scrolls in
      // from the right — the way every live monitor behaves.
      //
      // An earlier version pinned the left edge at t=0 until the session grew
      // past a span, which let the axis stand still early on. It also left
      // "now" a third of the way across with a large empty stretch ahead of
      // it, which reads as a graph that has stopped rather than one that is
      // filling. The empty stretch belongs behind the line, not in front.
      const total = this.span / LEAD_POSITION;
      const from = newestMs - this.span;
      return { fromMs: from, toMs: from + total };
    }
    return { fromMs: this.anchor, toMs: this.anchor + this.span };
  }
}

function clampSpan(ms: number, sessionMs = Infinity): number {
  // The session's own length is the ceiling, but never below the floor: a
  // three-second session still gets a readable window.
  const ceiling = Math.max(MIN_SPAN_MS, Math.min(MAX_SPAN_MS, sessionMs));
  return Math.min(ceiling, Math.max(MIN_SPAN_MS, ms));
}
