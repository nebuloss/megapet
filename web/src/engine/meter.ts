/** Converts a byte count over a millisecond span into Mbps. */
export function toMbps(bytes: number, ms: number): number {
  return ms > 0 ? (bytes * 8) / ms / 1000 : 0;
}

interface Sample {
  t: number;
  bytes: number;
}

const HISTORY_MS = 6000;

/**
 * Accumulates transferred bytes and reports two different rates:
 *
 *  - `live()` over a short trailing window, which drives the gauge;
 *  - `final()` over the measurement window, which excludes the ramp-up period
 *    where TCP is still growing its congestion window and the figure would be
 *    misleadingly low.
 */
export class RateMeter {
  private total = 0;
  private samples: Sample[] = [];
  private startedAt = 0;
  private baseBytes = 0;
  private baseTime = 0;
  private graced = false;

  start(now = performance.now()): void {
    this.startedAt = now;
    this.baseTime = now;
    this.baseBytes = 0;
    this.total = 0;
    this.graced = false;
    this.samples = [{ t: now, bytes: 0 }];
  }

  add(bytes: number): void {
    this.total += bytes;
  }

  get bytes(): number {
    return this.total;
  }

  /** Bytes transferred inside the measurement window. */
  get measuredBytes(): number {
    return this.total - this.baseBytes;
  }

  get startTime(): number {
    return this.startedAt;
  }

  get hasGraced(): boolean {
    return this.graced;
  }

  /** Marks the end of the ramp-up period; everything before it is discarded. */
  markGrace(now = performance.now()): void {
    this.baseBytes = this.total;
    this.baseTime = now;
    this.graced = true;
  }

  sample(now = performance.now()): void {
    this.samples.push({ t: now, bytes: this.total });
    const cutoff = now - HISTORY_MS;
    let drop = 0;
    while (drop + 1 < this.samples.length && this.samples[drop + 1]!.t < cutoff) drop++;
    if (drop > 0) this.samples.splice(0, drop);
  }

  /** Throughput over the trailing `windowMs`. */
  live(windowMs = 1000, now = performance.now()): number {
    const cutoff = now - windowMs;
    let anchor = this.samples[0];
    if (!anchor) return 0;
    for (const s of this.samples) {
      if (s.t > cutoff) break;
      anchor = s;
    }
    return toMbps(this.total - anchor.bytes, now - anchor.t);
  }

  /** Throughput over the whole post-grace measurement window. */
  final(now = performance.now()): number {
    return toMbps(this.total - this.baseBytes, now - this.baseTime);
  }
}
