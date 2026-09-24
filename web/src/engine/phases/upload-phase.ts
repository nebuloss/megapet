import type { RateMeter } from '../meter';
import { TransferPhase, type TransferOptions } from './transfer-phase';

export interface UploadOptions extends TransferOptions {
  readonly chunkBytes: number;
}

/**
 * Bounds on a single upload request.
 *
 * The floor is what stops per-request turnaround dominating the measurement.
 * Measured against a local server, six streams of 1 MiB chunks reach about
 * 8 Gbps where 16 MiB chunks reach 20 — the small requests spend most of
 * their time being set up and torn down, and the figure that comes out is a
 * measure of request overhead rather than of the link. 4 MiB is where that
 * curve flattens.
 *
 * The ceiling stops one request outlasting the window it is measured in: at
 * 64 MiB a request takes over 150ms even on a local link, and on a slow one a
 * single chunk would never finish.
 */
const MIN_CHUNK = 4 * 1024 * 1024;
const MAX_CHUNK = 64 * 1024 * 1024;

/** `crypto.getRandomValues` caps each call at 64 KiB. */
const RANDOM_STEP = 65536;

/** Pushes incompressible bytes to the server on N parallel streams. */
export class UploadPhase extends TransferPhase {
  protected readonly name = 'upload';
  private readonly payload: Blob;

  constructor(private readonly uploadOptions: UploadOptions) {
    super(uploadOptions);
    this.payload = UploadPhase.randomPayload(
      Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, Math.round(uploadOptions.chunkBytes))),
    );
  }

  protected async transfer(meter: RateMeter, signal: AbortSignal, index: number): Promise<void> {
    await this.withRetries(signal, async (failures) => {
      const url =
        `${this.uploadOptions.base}/api/upload?r=${TransferPhase.nonce(index, failures)}`;
      await this.post(url, meter, signal);
    });
  }

  /**
   * Uploads one chunk.
   *
   * `fetch` cannot report upload progress without a duplex request body, which
   * only some browsers support, so XHR is still the portable way to see bytes
   * leaving the tab while they leave it.
   */
  private post(url: string, meter: RateMeter, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      let counted = 0;

      const onAbort = (): void => request.abort();
      const cleanup = (): void => signal.removeEventListener('abort', onAbort);

      request.upload.addEventListener('progress', (event) => {
        const delta = event.loaded - counted;
        if (delta > 0) {
          counted = event.loaded;
          meter.add(delta);
        }
      });
      request.addEventListener('load', () => {
        // The final progress event is not guaranteed to reach the full size.
        const remainder = this.payload.size - counted;
        if (remainder > 0) meter.add(remainder);
        cleanup();
        resolve();
      });
      request.addEventListener('error', () => {
        cleanup();
        reject(new Error('upload request failed'));
      });
      request.addEventListener('timeout', () => {
        cleanup();
        reject(new Error('upload request timed out'));
      });
      // An abort is how every stream ends when the window closes.
      request.addEventListener('abort', () => {
        cleanup();
        resolve();
      });

      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        cleanup();
        resolve();
        return;
      }

      request.open('POST', url, true);
      request.setRequestHeader('Content-Type', 'application/octet-stream');
      request.send(this.payload);
    });
  }

  /** Incompressible bytes, so nothing on the path can shortcut the transfer. */
  private static randomPayload(size: number): Blob {
    const buffer = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += RANDOM_STEP) {
      crypto.getRandomValues(buffer.subarray(offset, Math.min(offset + RANDOM_STEP, size)));
    }
    return new Blob([buffer], { type: 'application/octet-stream' });
  }
}
