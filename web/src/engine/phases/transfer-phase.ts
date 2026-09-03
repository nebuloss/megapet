import { RateMeter } from '../meter';
import { sleep } from '../sleep';

export interface TransferResult {
  /** Throughput over the measurement window, in Mbps. */
  readonly mbps: number;
  /** Bytes counted inside the measurement window. */
  readonly bytes: number;
  /** Total bytes moved, including the discarded ramp-up. */
  readonly totalBytes: number;
}

export interface TransferOptions {
  readonly base: string;
  readonly streams: number;
  readonly durationMs: number;
  readonly graceMs: number;
  readonly overhead: number;
  readonly signal: AbortSignal;
  readonly onTick: (liveMbps: number, progress: number) => void;
}

/** How often the meter is sampled and the gauge updated. */
const TICK_MS = 50;

/** Consecutive failures on one stream before the phase is considered broken. */
const MAX_STREAM_FAILURES = 3;

/**
 * The shared machinery of a throughput phase.
 *
 * Download and upload differ in exactly one respect — what a worker does — so
 * this owns everything else: the clock, the meter, the grace period, the
 * abort, and the decision that all-workers-failed is an error while
 * one-worker-aborted is not. Subclasses implement `transfer` and inherit the
 * measurement.
 *
 * The phase always ends on the clock, never on the workers. They are aborted
 * once the window closes, so a worker cut off mid-transfer is the normal
 * ending rather than a failure.
 */
export abstract class TransferPhase {
  protected constructor(protected readonly options: TransferOptions) {}

  /** Human-readable name, used in error messages. */
  protected abstract readonly name: string;

  /**
   * Moves bytes until `signal` aborts, reporting them to `meter` as they go.
   *
   * Called once per stream. Implementations should treat an abort as a clean
   * return and may retry transient failures via `withRetries`.
   */
  protected abstract transfer(meter: RateMeter, signal: AbortSignal, index: number): Promise<void>;

  async run(): Promise<TransferResult> {
    const { signal, streams, durationMs, graceMs, overhead, onTick } = this.options;

    const meter = new RateMeter();
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal.addEventListener('abort', abort, { once: true });

    const started = performance.now();
    meter.start(started);

    let captured: TransferResult | null = null;
    const capture = (now: number): void => {
      if (captured) return;
      if (!meter.hasGraced) meter.markGrace(now); // window shorter than the grace
      captured = {
        mbps: meter.final(now) * overhead,
        bytes: meter.measuredBytes,
        totalBytes: meter.bytes,
      };
    };

    const ticker = setInterval(() => {
      const now = performance.now();
      meter.sample(now);
      const elapsed = now - started;

      if (!meter.hasGraced && elapsed >= graceMs) meter.markGrace(now);

      if (elapsed >= durationMs) {
        capture(now);
        clearInterval(ticker);
        controller.abort();
        return;
      }
      onTick(meter.live() * overhead, Math.min(1, elapsed / durationMs));
    }, TICK_MS);

    try {
      const outcomes = await Promise.allSettled(
        Array.from({ length: Math.max(1, streams) }, (_, index) =>
          this.transfer(meter, controller.signal, index),
        ),
      );
      // Every worker failing means the endpoint is unreachable, not that the
      // connection is slow — surface that rather than reporting 0 Mbps.
      const failure = outcomes.find((outcome) => outcome.status === 'rejected');
      if (failure && outcomes.every((outcome) => outcome.status === 'rejected') && !signal.aborted) {
        throw (failure as PromiseRejectedResult).reason;
      }
    } finally {
      clearInterval(ticker);
      controller.abort();
      signal.removeEventListener('abort', abort);
    }

    if (signal.aborted && !captured) throw new DOMException(`${this.name} aborted`, 'AbortError');
    capture(performance.now());
    return captured!;
  }

  /**
   * Runs `attempt` in a loop until the signal aborts, retrying transient
   * failures with a short backoff and giving up after `MAX_STREAM_FAILURES`.
   */
  protected async withRetries(
    signal: AbortSignal,
    attempt: (failures: number) => Promise<void>,
  ): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      try {
        await attempt(failures);
        failures = 0;
      } catch (error) {
        if (signal.aborted || TransferPhase.isAbort(error)) return;
        if (++failures >= MAX_STREAM_FAILURES) throw error;
        await sleep(Math.min(500, 50 * 2 ** failures), signal);
      }
    }
  }

  /** A cache-busting suffix, so no request can be served from a cache. */
  protected static nonce(index: number, attempt: number): string {
    return `${Date.now().toString(36)}-${index}-${attempt}`;
  }

  protected static isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }
}
