import { describe, expect, it } from 'vitest';
import type { RateMeter } from '../meter';
import { TransferPhase, type TransferOptions, type TransferTick } from './transfer-phase';

/** A phase that moves bytes without a network, so the timing can be tested. */
class FakePhase extends TransferPhase {
  protected readonly name = 'fake';

  constructor(
    options: TransferOptions,
    private readonly bytesPerStep = 125_000,
  ) {
    super(options);
  }

  protected async transfer(meter: RateMeter, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      meter.add(this.bytesPerStep);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

function optionsFor(
  signal: AbortSignal,
  durationMs: number,
  onTick: (tick: TransferTick) => void = () => {},
): TransferOptions {
  return { base: '', streams: 2, durationMs, graceMs: 0, overhead: 1, signal, onTick };
}

describe('a phase with a window', () => {
  it('ends on its own clock and reports what it moved', async () => {
    const controller = new AbortController();
    const result = await new FakePhase(optionsFor(controller.signal, 150)).run();
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(result.mbps).toBeGreaterThan(0);
  });

  it('reports progress towards its end', async () => {
    const controller = new AbortController();
    const ticks: TransferTick[] = [];
    await new FakePhase(optionsFor(controller.signal, 200, (tick) => ticks.push(tick))).run();
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.at(-1)!.progress).toBeGreaterThan(0);
  });

  it('treats being cut short as a failure, because its window did not finish', async () => {
    const controller = new AbortController();
    const phase = new FakePhase(optionsFor(controller.signal, 10_000));
    setTimeout(() => controller.abort(), 60);
    await expect(phase.run()).rejects.toThrow(/aborted/i);
  });
});

/**
 * The continuous monitor's half of the contract. An endless phase is ended by
 * its caller, so the abort that ends a ten-second phase early is instead the
 * normal way this one finishes — it must return a result rather than throw.
 */
describe('a phase with no window', () => {
  it('runs until the caller stops it, then returns normally', async () => {
    const controller = new AbortController();
    const phase = new FakePhase(optionsFor(controller.signal, Infinity));
    setTimeout(() => controller.abort(), 150);
    const result = await phase.run();
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it('keeps ticking while it runs', async () => {
    const controller = new AbortController();
    const ticks: TransferTick[] = [];
    const phase = new FakePhase(optionsFor(controller.signal, Infinity, (t) => ticks.push(t)));
    setTimeout(() => controller.abort(), 200);
    await phase.run();
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.at(-1)!.bytes).toBeGreaterThan(0);
    expect(ticks.at(-1)!.liveMbps).toBeGreaterThan(0);
  });

  // There is no window to be a fraction of, and a progress bar creeping
  // towards an end that never comes would be a lie.
  it('never claims progress', async () => {
    const controller = new AbortController();
    const ticks: TransferTick[] = [];
    const phase = new FakePhase(optionsFor(controller.signal, Infinity, (t) => ticks.push(t)));
    setTimeout(() => controller.abort(), 150);
    await phase.run();
    expect(ticks.every((tick) => tick.progress === 0)).toBe(true);
  });

  it('reports an average as well as a live rate', async () => {
    const controller = new AbortController();
    const ticks: TransferTick[] = [];
    const phase = new FakePhase(optionsFor(controller.signal, Infinity, (t) => ticks.push(t)));
    setTimeout(() => controller.abort(), 200);
    await phase.run();
    expect(ticks.at(-1)!.averageMbps).toBeGreaterThan(0);
  });
});
