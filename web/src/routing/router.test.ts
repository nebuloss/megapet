import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from './router';

/**
 * A minimal History API, since these tests run in node.
 *
 * Only what the router touches: the current path, and whether a change was
 * pushed (a new step you can go back to) or replaced (a correction that is
 * not a step at all). That distinction is the substance of these tests.
 */
function stubHistory(path: string): { pushed: string[]; replaced: string[] } {
  const pushed: string[] = [];
  const replaced: string[] = [];
  const location = { pathname: path };

  vi.stubGlobal('window', {
    location,
    history: {
      pushState: (_s: unknown, _t: string, to: string) => {
        pushed.push(to);
        location.pathname = to;
      },
      replaceState: (_s: unknown, _t: string, to: string) => {
        replaced.push(to);
        location.pathname = to;
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  });

  return { pushed, replaced };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('routing', () => {
  it('resolves a registered path', () => {
    stubHistory('/manual');
    const seen: string[] = [];
    new Router()
      .add('/manual', () => seen.push('manual'))
      .fallback(() => seen.push('home'))
      .start();
    expect(seen).toEqual(['manual']);
  });

  it('passes named parameters to the handler', () => {
    stubHistory('/r/ABC123');
    let id = '';
    new Router()
      .add('/r/:id', (params) => {
        id = params.id ?? '';
      })
      .fallback(() => {})
      .start();
    expect(id).toBe('ABC123');
  });

  it('takes the first matching route', () => {
    stubHistory('/r/ABC');
    const seen: string[] = [];
    new Router()
      .add('/r/:id', () => seen.push('result'))
      .add('/r/:other', () => seen.push('shadowed'))
      .fallback(() => seen.push('home'))
      .start();
    expect(seen).toEqual(['result']);
  });
});

/**
 * The server serves the application for any unknown path, so a stale URL
 * renders the right page under the wrong address. Left alone it can be
 * bookmarked, refreshed and shared. `/graph` is the live example: it was a
 * route until the graph became a dialog.
 */
describe('an address that no longer exists', () => {
  it('still shows the page it falls back to', () => {
    stubHistory('/graph');
    const seen: string[] = [];
    new Router().fallback(() => seen.push('home')).start();
    expect(seen).toEqual(['home']);
  });

  it('is rewritten in the address bar', () => {
    const { replaced } = stubHistory('/graph');
    new Router().fallback(() => {}).start();
    expect(replaced).toEqual(['/']);
  });

  /**
   * Replaced rather than pushed: the bad path was never a place, so going
   * back from the corrected page must not return to it — which would correct
   * it again, and trap the visitor in a loop.
   */
  it('does not become a step in the history', () => {
    const { pushed } = stubHistory('/nonsense/deep/path');
    new Router().fallback(() => {}).start();
    expect(pushed).toEqual([]);
  });

  it('leaves a path that is already correct alone', () => {
    const { replaced } = stubHistory('/');
    new Router().fallback(() => {}).start();
    expect(replaced).toEqual([]);
  });

  it('does not rewrite a path that matched a real route', () => {
    const { replaced } = stubHistory('/manual');
    new Router()
      .add('/manual', () => {})
      .fallback(() => {})
      .start();
    expect(replaced).toEqual([]);
  });

  it('can be told to correct somewhere other than the root', () => {
    const { replaced } = stubHistory('/gone');
    new Router().fallback(() => {}, '/manual').start();
    expect(replaced).toEqual(['/manual']);
  });
});
