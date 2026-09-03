import type { TestParams } from '../domain/types';
import { measureLatency, type LatencyResult } from './latency';
import { sleep } from './sleep';
import { DownloadPhase, UploadPhase, type TransferResult } from './phases';

export type Phase =
  | 'idle'
  | 'latency'
  | 'reversing'
  | 'download'
  | 'upload'
  | 'done'
  | 'aborted'
  | 'error';

export interface Snapshot {
  phase: Phase;
  /** 0..1 across the whole run. */
  progress: number;
  /** The figure the gauge should show right now, in Mbps. */
  liveMbps: number;
  pingMs: number;
  jitterMs: number;
  pingMinMs: number;
  pingMaxMs: number;
  downloadMbps: number;
  uploadMbps: number;
  downloadBytes: number;
  uploadBytes: number;
  /** During `reversing`, the phase the machine is being set up for. */
  nextPhase?: 'download' | 'upload';
  error?: string;
}

/** Share of the overall progress bar given to each phase. */
const WEIGHTS = { latency: 0.1, reverse: 0.04, download: 0.42, upload: 0.4 } as const;

/** Where each measuring phase starts on the overall progress bar. */
const DOWNLOAD_FROM = WEIGHTS.latency + WEIGHTS.reverse;
const UPLOAD_FROM = DOWNLOAD_FROM + WEIGHTS.download + WEIGHTS.reverse;

export function emptySnapshot(): Snapshot {
  return {
    phase: 'idle',
    progress: 0,
    liveMbps: 0,
    pingMs: 0,
    jitterMs: 0,
    pingMinMs: 0,
    pingMaxMs: 0,
    downloadMbps: 0,
    uploadMbps: 0,
    downloadBytes: 0,
    uploadBytes: 0,
  };
}

/** How long the mounted visual asks each part of the run to be held open. */
export interface Pacing {
  /** Before the first latency probe, so a settling move has the frames alone. */
  readonly openingMs?: number;
  /** After the probes, so the visual's opening ride finishes inside the phase. */
  readonly latencyMs?: number;
  /** Between phases, while the drive is reversed. */
  readonly reverseMs?: number;
}

export class SpeedTest {
  private controller = new AbortController();
  private snapshot = emptySnapshot();
  private running = false;

  /**
   * `reverseMs` is a deliberate pause between phases. The direction of travel
   * changes there, and on a visual that shows the drive train that change is
   * worth watching with nothing else moving — so the reading is allowed to
   * settle, the machine is reversed, and only then does the next phase start
   * loading the link.
   *
   * `openingMs` is the same idea at the front, for the opposite reason: the
   * visual's settling move gets the main thread to itself so it cannot land in
   * the middle of the latency probes. `latencyMs` then holds the phase open
   * afterwards, so a visual with something to play during the ping — a lift
   * being called up the shaft — is not cut off by the reversal behind it.
   */
  constructor(
    private readonly params: TestParams,
    private readonly base = '',
    private readonly pacing: Pacing = {},
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  abort(): void {
    this.controller.abort();
  }

  /**
   * Runs latency, then download, then upload, in that order. They are kept
   * sequential on purpose: overlapping them would have each phase measuring a
   * link the other phase is already saturating.
   */
  async run(onUpdate: (snapshot: Snapshot) => void): Promise<Snapshot> {
    if (this.running) throw new Error('a test is already running');
    this.running = true;
    this.controller = new AbortController();
    this.snapshot = emptySnapshot();

    const signal = this.controller.signal;
    const emit = (patch: Partial<Snapshot>): void => {
      this.snapshot = { ...this.snapshot, ...patch };
      onUpdate(this.snapshot);
    };

    try {
      performance.clearResourceTimings?.();

      // ---- latency -------------------------------------------------------
      emit({ phase: 'latency', progress: 0, liveMbps: 0 });
      // A ping on a local link is a millisecond or two, small enough that one
      // janked frame outweighs the thing being measured. So the visual's
      // opening move is allowed to finish before the first probe goes out.
      if (this.pacing.openingMs) await sleep(this.pacing.openingMs, signal);
      const openedAt = performance.now();
      const latency: LatencyResult = await measureLatency({
        base: this.base,
        count: this.params.ping_count,
        warmup: this.params.ping_warmup,
        signal,
        onSample: (done, total, rtt) => {
          emit({
            progress: (done / total) * WEIGHTS.latency,
            liveMbps: rtt,
            pingMs: rtt,
          });
        },
      });
      this.throwIfAborted(signal);
      emit({
        progress: WEIGHTS.latency,
        pingMs: latency.min,
        pingMinMs: latency.min,
        pingMaxMs: latency.max,
        jitterMs: latency.jitter,
        liveMbps: 0,
      });
      // The probes are done, but the visual may still be playing something —
      // the car being called up the shaft — and the reversal must not cut it
      // off. Elapsed probe time counts towards it, so a slow link waits less.
      const played = performance.now() - openedAt;
      const remaining = (this.pacing.latencyMs ?? 0) - played;
      if (remaining > 0) await sleep(remaining, signal);
      this.throwIfAborted(signal);

      // ---- reverse, then download ----------------------------------------
      await this.reverse('download', WEIGHTS.latency, emit, signal);
      emit({ phase: 'download' });
      const download: TransferResult = await new DownloadPhase({
        base: this.base,
        streams: this.params.download_streams,
        durationMs: this.params.download_seconds * 1000,
        graceMs: this.params.grace_seconds * 1000,
        overhead: this.params.overhead_factor || 1,
        signal,
        onTick: (mbps, phaseProgress) => {
          emit({
            liveMbps: mbps,
            downloadMbps: mbps,
            progress: DOWNLOAD_FROM + phaseProgress * WEIGHTS.download,
          });
        },
      }).run();
      this.throwIfAborted(signal);
      emit({
        downloadMbps: download.mbps,
        downloadBytes: download.totalBytes,
        liveMbps: download.mbps,
        progress: DOWNLOAD_FROM + WEIGHTS.download,
      });

      // ---- reverse, then upload ------------------------------------------
      await this.reverse('upload', DOWNLOAD_FROM + WEIGHTS.download, emit, signal);
      emit({ phase: 'upload', liveMbps: 0 });
      const upload: TransferResult = await new UploadPhase({
        base: this.base,
        streams: this.params.upload_streams,
        durationMs: this.params.upload_seconds * 1000,
        graceMs: this.params.grace_seconds * 1000,
        overhead: this.params.overhead_factor || 1,
        chunkBytes: this.chunkSizeFor(download.mbps),
        signal,
        onTick: (mbps, phaseProgress) => {
          emit({
            liveMbps: mbps,
            uploadMbps: mbps,
            progress: UPLOAD_FROM + phaseProgress * WEIGHTS.upload,
          });
        },
      }).run();
      this.throwIfAborted(signal);

      emit({
        phase: 'done',
        progress: 1,
        uploadMbps: upload.mbps,
        uploadBytes: upload.totalBytes,
        liveMbps: upload.mbps,
      });
      return this.snapshot;
    } catch (err) {
      if (signal.aborted) {
        emit({ phase: 'aborted', liveMbps: 0 });
      } else {
        emit({ phase: 'error', liveMbps: 0, error: describeError(err) });
      }
      return this.snapshot;
    } finally {
      this.running = false;
    }
  }

  /**
   * Holds between phases while the drive direction changes. The reading is
   * pinned at zero so the dial settles and the machine can be seen changing
   * over on its own.
   */
  private async reverse(
    next: 'download' | 'upload',
    progress: number,
    emit: (patch: Partial<Snapshot>) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.pacing.reverseMs || this.pacing.reverseMs <= 0) return;
    emit({ phase: 'reversing', nextPhase: next, liveMbps: 0, progress });
    await sleep(this.pacing.reverseMs, signal);
    this.throwIfAborted(signal);
  }

  /**
   * Sizes an upload chunk so a single request lasts a few hundred milliseconds
   * on this link: small enough that progress stays smooth, large enough that
   * per-request overhead does not eat into the measurement.
   */
  private chunkSizeFor(downloadMbps: number): number {
    if (!Number.isFinite(downloadMbps) || downloadMbps <= 0) {
      return this.params.upload_chunk_bytes;
    }
    const perStreamBytesPerSecond =
      (downloadMbps * 1e6) / 8 / Math.max(1, this.params.upload_streams);
    return Math.round(perStreamBytesPerSecond * 0.25);
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('test aborted', 'AbortError');
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
