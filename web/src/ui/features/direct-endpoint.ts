import type { ClientConfig, Peer } from '../../domain/types';
import { measureLatency } from '../../engine/latency';

/** The synthetic peer id used for the server's own address. */
export const DIRECT_PEER_ID = 'direct';

/** How long to wait for the direct address to answer before giving up on it. */
const PROBE_TIMEOUT_MS = 1500;

export type DirectAvailability =
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'offered'; readonly peer: Peer };

/**
 * The server's own address, offered as a peer so it measures through the same
 * path as any other backend.
 *
 * A reverse proxy is the honest answer to "how fast is this server for me" —
 * it is how clients reach it. It is the wrong answer to "how fast is this
 * link": the proxy adds a copy per buffer, and with response buffering left on
 * it can understate a download by an order of magnitude. Measuring against the
 * server directly, while still loading the page and saving results through the
 * proxy, gives the second number without giving up the first.
 */
export function directPeer(config: ClientConfig): DirectAvailability {
  const url = config.direct_url?.trim();
  if (!url) return { status: 'unavailable', reason: 'not advertised by the server' };

  // A page served over https cannot fetch an http origin: the browser blocks
  // it as mixed content, with no way for the page to detect or recover. Better
  // to not offer it than to offer something that silently fails.
  if (window.location.protocol === 'https:' && url.startsWith('http://')) {
    return {
      status: 'unavailable',
      reason: 'the page is https and the direct address is http, which browsers block',
    };
  }

  return {
    status: 'offered',
    peer: {
      id: DIRECT_PEER_ID,
      name: 'Direct',
      url,
      location: 'bypasses the reverse proxy',
    },
  };
}

/**
 * Checks that the direct address actually answers.
 *
 * It routinely will not: a firewall, a different network, or a proxy that is
 * the only route in. Failing quietly and staying on the proxy is the right
 * outcome — the measurement is still valid, just of a different thing.
 */
export async function directIsReachable(peer: Peer): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const latency = await measureLatency({
      base: peer.url,
      count: 2,
      warmup: 1,
      signal: controller.signal,
    });
    return latency.samples.length > 0;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
