/**
 * A minimal typed observer.
 *
 * Used where something long-lived has to tell several unrelated views that it
 * changed — the theme being the case that matters. Subscribing returns the
 * unsubscribe function rather than requiring the caller to hold on to the
 * original callback, which is what makes `destroy()` implementations one-liners.
 */
export type Listener<T> = (value: T) => void;

export class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  /** Subscribes, and returns a function that unsubscribes. */
  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    // Copied first: a listener is allowed to unsubscribe itself while running.
    for (const listener of [...this.listeners]) listener(value);
  }

  clear(): void {
    this.listeners.clear();
  }

  get size(): number {
    return this.listeners.size;
  }
}
