import type { RateMeter } from '../meter';
import { TransferPhase, type TransferOptions } from './transfer-phase';

/**
 * How much a single request asks for.
 *
 * Large enough that a stream almost never has to issue a second one, so the
 * measurement is not punctuated by connection setup; the client aborts the
 * response when the window closes, which is why asking for more than will
 * arrive costs nothing.
 */
const REQUEST_BYTES = 2 * 1024 ** 3;

/** Pulls incompressible bytes from the server on N parallel streams. */
export class DownloadPhase extends TransferPhase {
  protected readonly name = 'download';

  constructor(options: TransferOptions) {
    super(options);
  }

  protected async transfer(meter: RateMeter, signal: AbortSignal, index: number): Promise<void> {
    await this.withRetries(signal, async (failures) => {
      const url =
        `${this.options.base}/api/download?bytes=${REQUEST_BYTES}` +
        `&r=${TransferPhase.nonce(index, failures)}`;

      const response = await fetch(url, { cache: 'no-store', signal });
      if (!response.ok) throw new Error(`download endpoint returned ${response.status}`);
      if (!response.body) {
        throw new Error('streaming responses are not supported by this browser');
      }

      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // Compression is disabled server-side, so decoded length is wire length.
        if (value) meter.add(value.byteLength);
      }
    });
  }
}
