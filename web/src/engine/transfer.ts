import { RateMeter } from './meter';
import { sleep } from './sleep';

export interface TransferResult {
  /** Throughput over the measurement window, in Mbps. */
  mbps: number;
  /** Bytes counted inside the measurement window. */
  bytes: number;
  /** Total bytes moved including the discarded ramp-up. */
  totalBytes: number;
}

export interface TransferOptions {
  base: string;
  streams: number;
  durationMs: number;
  graceMs: number;
  overhead: number;
  signal: AbortSignal;
  onTick: (liveMbps: number, progress: number) => void;
}

/** How often the meter is sampled and the gauge updated. */
const TICK_MS = 50;

/** A single download request asks for this much; a stream loops if it runs out. */
const DOWNLOAD_REQUEST_BYTES = 2 * 1024 ** 3;

/** Consecutive failures per stream before the phase is considered broken. */
const MAX_STREAM_FAILURES = 3;

/**
 * Drives `streams` concurrent workers for `durationMs`, ticking a gauge as it
 * goes, and resolves with the rate measured after the grace period.
 *
 * The phase always ends on the clock, never on the workers: they are aborted
 * once the window closes, and a worker aborted mid-transfer is a normal ending
 * rather than an error.
 */
async function runPhase(
  opt: TransferOptions,
  worker: (meter: RateMeter, signal: AbortSignal, index: number) => Promise<void>,
): Promise<TransferResult> {
  const meter = new RateMeter();
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  opt.signal.addEventListener('abort', abort, { once: true });

  const started = performance.now();
  meter.start(started);

  let captured: TransferResult | null = null;
  const capture = (now: number): void => {
    if (captured) return;
    if (!meter.hasGraced) meter.markGrace(now); // window shorter than the grace
    captured = {
      mbps: meter.final(now) * opt.overhead,
      bytes: meter.measuredBytes,
      totalBytes: meter.bytes,
    };
  };

  const ticker = setInterval(() => {
    const now = performance.now();
    meter.sample(now);
    const elapsed = now - started;

    if (!meter.hasGraced && elapsed >= opt.graceMs) meter.markGrace(now);

    if (elapsed >= opt.durationMs) {
      capture(now);
      clearInterval(ticker);
      controller.abort();
      return;
    }
    opt.onTick(meter.live() * opt.overhead, Math.min(1, elapsed / opt.durationMs));
  }, TICK_MS);

  try {
    const outcomes = await Promise.allSettled(
      Array.from({ length: Math.max(1, opt.streams) }, (_, i) =>
        worker(meter, controller.signal, i),
      ),
    );
    // Every worker failing means the endpoint is unreachable, not that the
    // connection is slow — surface that rather than reporting 0 Mbps.
    const failure = outcomes.find((o) => o.status === 'rejected');
    if (failure && outcomes.every((o) => o.status === 'rejected') && !opt.signal.aborted) {
      throw (failure as PromiseRejectedResult).reason;
    }
  } finally {
    clearInterval(ticker);
    controller.abort();
    opt.signal.removeEventListener('abort', abort);
  }

  if (opt.signal.aborted && !captured) {
    throw new DOMException('test aborted', 'AbortError');
  }
  capture(performance.now());
  return captured!;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export function measureDownload(opt: TransferOptions): Promise<TransferResult> {
  return runPhase(opt, async (meter, signal, index) => {
    let failures = 0;
    while (!signal.aborted) {
      const url =
        `${opt.base}/api/download?bytes=${DOWNLOAD_REQUEST_BYTES}` +
        `&r=${Date.now().toString(36)}-${index}-${failures}`;
      try {
        const res = await fetch(url, { cache: 'no-store', signal });
        if (!res.ok) throw new Error(`download endpoint returned ${res.status}`);
        if (!res.body) throw new Error('streaming responses are not supported by this browser');

        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) meter.add(value.byteLength);
        }
        failures = 0;
      } catch (err) {
        if (signal.aborted || isAbort(err)) return;
        if (++failures >= MAX_STREAM_FAILURES) throw err;
        await backoff(failures, signal);
      }
    }
  });
}

export interface UploadOptions extends TransferOptions {
  chunkBytes: number;
}

export function measureUpload(opt: UploadOptions): Promise<TransferResult> {
  const payload = randomPayload(clamp(opt.chunkBytes, 256 * 1024, 32 * 1024 * 1024));

  return runPhase(opt, async (meter, signal, index) => {
    let failures = 0;
    while (!signal.aborted) {
      try {
        await postChunk(
          `${opt.base}/api/upload?r=${Date.now().toString(36)}-${index}-${failures}`,
          payload,
          meter,
          signal,
        );
        failures = 0;
      } catch (err) {
        if (signal.aborted) return;
        if (++failures >= MAX_STREAM_FAILURES) throw err;
        await backoff(failures, signal);
      }
    }
  });
}

/**
 * Uploads one chunk.
 *
 * `fetch` cannot report upload progress without a duplex request body, which
 * only some browsers support, so XHR is still the portable way to see bytes
 * leaving the tab while they leave it.
 */
function postChunk(
  url: string,
  payload: Blob,
  meter: RateMeter,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let counted = 0;

    const onAbort = (): void => xhr.abort();
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);

    xhr.upload.addEventListener('progress', (e) => {
      const delta = e.loaded - counted;
      if (delta > 0) {
        counted = e.loaded;
        meter.add(delta);
      }
    });
    xhr.addEventListener('load', () => {
      // The final progress event is not guaranteed to reach the full size.
      const remainder = payload.size - counted;
      if (remainder > 0) meter.add(remainder);
      cleanup();
      resolve();
    });
    xhr.addEventListener('error', () => {
      cleanup();
      reject(new Error('upload request failed'));
    });
    xhr.addEventListener('timeout', () => {
      cleanup();
      reject(new Error('upload request timed out'));
    });
    // An abort is how every stream ends when the window closes.
    xhr.addEventListener('abort', () => {
      cleanup();
      resolve();
    });

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      cleanup();
      resolve();
      return;
    }

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.send(payload);
  });
}

/** Incompressible bytes, so nothing on the path can shortcut the transfer. */
function randomPayload(size: number): Blob {
  const buffer = new Uint8Array(size);
  const step = 65536; // crypto.getRandomValues caps each call at 64 KiB
  for (let offset = 0; offset < size; offset += step) {
    crypto.getRandomValues(buffer.subarray(offset, Math.min(offset + step, size)));
  }
  return new Blob([buffer], { type: 'application/octet-stream' });
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

function backoff(attempt: number, signal: AbortSignal): Promise<void> {
  return sleep(Math.min(500, 50 * 2 ** attempt), signal);
}
