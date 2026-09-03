/**
 * The shape every UI piece in this app shares.
 *
 * A view owns exactly one element and knows how to let go of anything it
 * attached elsewhere. That is the whole contract: it keeps composition trivial
 * (a parent appends `child.root`) and it makes teardown uniform, which matters
 * because several views register listeners on `window` or `document`.
 */
export interface View {
  readonly root: HTMLElement;
  /** Releases listeners, timers and animation frames. Safe to call twice. */
  destroy(): void;
}

/**
 * Convenience base for views that are a single element and nothing more.
 *
 * Subclasses that need teardown override `destroy`; the rest inherit a no-op
 * so callers never have to check whether the method exists.
 */
export abstract class Component<E extends HTMLElement = HTMLElement> implements View {
  readonly root: E;

  protected constructor(root: E) {
    this.root = root;
  }

  destroy(): void {
    /* nothing attached outside `root` by default */
  }
}
