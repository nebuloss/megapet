/**
 * Typed access to `localStorage`, which is allowed to fail.
 *
 * In a private window, or with site data blocked, every one of these calls
 * throws — including the read. Wrapping it once here means the rest of the app
 * can treat a stored preference as "the value or nothing" instead of repeating
 * the same try/catch at each use, which is how one of them ends up forgotten.
 */
export class Preferences {
  constructor(private readonly namespace: string) {}

  private key(name: string): string {
    return `${this.namespace}.${name}`;
  }

  get(name: string): string | null {
    try {
      return localStorage.getItem(this.key(name));
    } catch {
      return null;
    }
  }

  /** Reads a value constrained to a known set, falling back when it is not one. */
  getOneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const stored = this.get(name);
    return allowed.includes(stored as T) ? (stored as T) : fallback;
  }

  set(name: string, value: string): void {
    try {
      localStorage.setItem(this.key(name), value);
    } catch {
      /* the choice simply will not persist */
    }
  }

  remove(name: string): void {
    try {
      localStorage.removeItem(this.key(name));
    } catch {
      /* nothing to do */
    }
  }
}
