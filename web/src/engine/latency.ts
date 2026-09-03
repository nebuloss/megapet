export interface LatencyResult {
  samples: number[];
  min: number;
  median: number;
  max: number;
  /** Mean absolute difference between consecutive round trips (RFC 3550 style). */
  jitter: number;
}

export interface LatencyOptions {
  base: string;
  count: number;
  warmup: number;
  signal: AbortSignal;
  onSample?: (done: number, total: number, rttMs: number) => void;
}

const EMPTY: LatencyResult = { samples: [], min: 0, median: 0, max: 0, jitter: 0 };

/**
 * Times a series of empty responses.
 *
 * Wall-clock timing around `fetch` includes scheduling and body-handling
 * overhead, so where the Resource Timing entry is available (the server sends
 * `Timing-Allow-Origin`, which makes it work cross-origin too) the network
 * portion is isolated as `responseStart - requestStart` instead.
 */
export async function measureLatency(opt: LatencyOptions): Promise<LatencyResult> {
  const samples: number[] = [];
  const total = Math.max(1, opt.count);
  const warmup = Math.max(0, opt.warmup);

  for (let i = 0; i < total + warmup; i++) {
    if (opt.signal.aborted) break;

    const url = `${opt.base}/api/ping?r=${Date.now().toString(36)}-${i}`;
    performance.clearResourceTimings?.();

    const t0 = performance.now();
    let rtt: number;
    try {
      const res = await fetch(url, { cache: 'no-store', signal: opt.signal });
      await res.arrayBuffer(); // the body is empty; this just settles the stream
      rtt = performance.now() - t0;
    } catch (err) {
      if (opt.signal.aborted) break;
      throw err;
    }

    const entries = performance.getEntriesByName(url, 'resource');
    const timing = entries[entries.length - 1] as PerformanceResourceTiming | undefined;
    if (timing && timing.requestStart > 0 && timing.responseStart >= timing.requestStart) {
      rtt = timing.responseStart - timing.requestStart;
    }

    if (i >= warmup) {
      samples.push(rtt);
      opt.onSample?.(samples.length, total, rtt);
    }

    // A short gap keeps consecutive probes from queueing on the same socket
    // write, which would otherwise show up as artificial jitter.
    await sleep(25, opt.signal);
  }

  return summarize(samples);
}

function summarize(samples: number[]): LatencyResult {
  if (samples.length === 0) return EMPTY;

  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);

  let jitter = 0;
  if (samples.length > 1) {
    let sum = 0;
    for (let i = 1; i < samples.length; i++) {
      sum += Math.abs((samples[i] ?? 0) - (samples[i - 1] ?? 0));
    }
    jitter = sum / (samples.length - 1);
  }

  return {
    samples,
    min: sorted[0] ?? 0,
    median,
    max: sorted[sorted.length - 1] ?? 0,
    jitter,
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
