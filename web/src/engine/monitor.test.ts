import { describe, expect, it } from 'vitest';
import { Monitor, describeDirections, isBidirectional, type Directions } from './monitor';
import type { TestParams } from '../domain/types';

const DOWN: Directions = { down: true, up: false };
const UP: Directions = { down: false, up: true };
const BOTH: Directions = { down: true, up: true };

/**
 * Directions are two switches rather than three named modes, so that the
 * engine, the buttons and the graph cannot drift apart over what "both" means.
 * These pin the only derived facts anything reads off them.
 */
/**
 * Switching every direction off leaves a session that is measuring nothing.
 * That is a thing to want — let the link settle and watch it unloaded — and
 * the clock, the graph and the history all carry on. It must not be mistaken
 * for the session ending: a leg finishing is not a session finishing.
 */
describe('a session with nothing selected', () => {
  const params: TestParams = {
    ping_count: 1,
    ping_warmup: 0,
    download_seconds: 1,
    upload_seconds: 1,
    grace_seconds: 0,
    download_streams: 1,
    upload_streams: 1,
    upload_chunk_bytes: 1024,
    overhead_factor: 1,
  };

  it('keeps running when the last direction is switched off', async () => {
    const monitor = new Monitor(params, 'http://127.0.0.1:1');
    const started = monitor.start(
      { down: true, up: false },
      { onUpdate: () => {}, onSample: () => {}, onError: () => {} },
    );

    // Let the leg fail against a dead address, as it will offline.
    await new Promise((resolve) => setTimeout(resolve, 20));
    monitor.setDirections({ down: false, up: false });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(monitor.isRunning).toBe(true);
    monitor.stop();
    await started;
    expect(monitor.isRunning).toBe(false);
  });

  it('refuses to begin with nothing selected, rather than idling', async () => {
    const monitor = new Monitor(params, 'http://127.0.0.1:1');
    await expect(
      monitor.start(
        { down: false, up: false },
        { onUpdate: () => {}, onSample: () => {}, onError: () => {} },
      ),
    ).rejects.toThrow(RangeError);
  });
});

describe('monitor directions', () => {
  it('recognises a two-way session, and only a two-way session', () => {
    expect(isBidirectional(BOTH)).toBe(true);
    expect(isBidirectional(DOWN)).toBe(false);
    expect(isBidirectional(UP)).toBe(false);
  });

  it('names each combination for announcements', () => {
    expect(describeDirections(DOWN)).toBe('download');
    expect(describeDirections(UP)).toBe('upload');
    expect(describeDirections(BOTH)).toContain('together');
  });

  it('has a name for the empty pair rather than returning undefined', () => {
    expect(describeDirections({ down: false, up: false })).toBe('nothing');
  });
});
