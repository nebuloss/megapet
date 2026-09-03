/**
 * Client-side routing over the History API.
 *
 * Routes are patterns with named parameters (`/r/:id`); the first match wins,
 * so register the specific ones before any catch-all. Kept deliberately small:
 * this app has two screens, and a router that only does what two screens need
 * is easier to reason about than a general one.
 */
export type RouteParams = Readonly<Record<string, string>>;
export type RouteHandler = (params: RouteParams) => void;

interface Route {
  readonly matcher: RegExp;
  readonly names: readonly string[];
  readonly handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];
  private readonly onPopState = (): void => this.resolve(window.location.pathname);
  private started = false;

  /**
   * @param pattern A path, with `:name` marking a parameter. A trailing slash
   *        is optional at match time.
   */
  add(pattern: string, handler: RouteHandler): this {
    const names: string[] = [];
    const source = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:(\w+)/g, (_, name: string) => {
        names.push(name);
        return '([^/]+)';
      });
    this.routes.push({ matcher: new RegExp(`^${source}/?$`), names, handler });
    return this;
  }

  /** Registers the handler used when nothing else matches. */
  fallback(handler: RouteHandler): this {
    this.routes.push({ matcher: /.*/, names: [], handler });
    return this;
  }

  /** Begins listening for back/forward, and resolves the current URL once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('popstate', this.onPopState);
    this.resolve(window.location.pathname);
  }

  /** Pushes a new path and resolves it. A no-op if already there. */
  navigate(path: string): void {
    if (window.location.pathname === path) return;
    window.history.pushState(null, '', path);
    this.resolve(path);
  }

  resolve(path: string): void {
    for (const route of this.routes) {
      const match = route.matcher.exec(path);
      if (!match) continue;
      const params: Record<string, string> = {};
      route.names.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1] ?? '');
      });
      route.handler(params);
      return;
    }
  }

  destroy(): void {
    window.removeEventListener('popstate', this.onPopState);
    this.started = false;
  }
}
