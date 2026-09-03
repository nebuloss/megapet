import type { TestParams } from '../types';
import { measureLatency, type LatencyResult } from './latency';
import { measureDownload, measureUpload, type TransferResult } from './transfer';

export type Phase = 'idle' | 'latency' | 'download' | 'upload' | 'done' | 'aborted' | 'error';

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
  error?: string;
}

/** Share of the overall progress bar given to each phase. */
const WEIGHTS = { latency: 0.12, download: 0.46, upload: 0.42 } as const;

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

export class SpeedTest {
  private controller = new AbortController();
  private snapshot = emptySnapshot();
  private running = false;

  constructor(
    private readonly params: TestParams,
    private readonly base = '',
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

      // ---- download ------------------------------------------------------
      emit({ phase: 'download' });
      const download: TransferResult = await measureDownload({
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
            progress: WEIGHTS.latency + phaseProgress * WEIGHTS.download,
          });
        },
      });
      this.throwIfAborted(signal);
      emit({
        downloadMbps: download.mbps,
        downloadBytes: download.totalBytes,
        liveMbps: download.mbps,
        progress: WEIGHTS.latency + WEIGHTS.download,
      });

      // ---- upload --------------------------------------------------------
      emit({ phase: 'upload', liveMbps: 0 });
      const upload: TransferResult = await measureUpload({
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
            progress: WEIGHTS.latency + WEIGHTS.download + phaseProgress * WEIGHTS.upload,
          });
        },
      });
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
