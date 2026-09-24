/**
 * The continuous monitor: a test with no end.
 *
 * The staged run in `runner.ts` answers "how fast is this link right now" and
 * stops, which is the right shape for a number you are going to save. This
 * answers a different question — "what does this link do over time" — and so
 * it never stops on its own, keeps a graph instead of a result, and saves
 * nothing.
 *
 * It needs no new server endpoint. The download source and upload sink already
 * stream for as long as anyone reads or writes, so an endless phase is just a
 * phase whose window is `Infinity`.
 *
 * **On `both`.** Running the two directions at once is the mode people ask for
 * and the one whose numbers are easiest to misread, so it is worth being blunt
 * about: the figures are no longer independent measurements. Upload and
 * download share one link, and on almost every consumer connection they share
 * it unequally — saturating the uplink delays the acks the downlink needs, so
 * the download figure drops for a reason that has nothing to do with the
 * downlink's capacity. Read `both` as "what the link does when pushed in both
 * directions", which is a real question, and read the one-way modes when you
 * want a capacity.
 */
import type { TestParams } from '../domain/types';
import { DownloadPhase, UploadPhase, type TransferTick } from './phases';
import { TimeSeries } from './series';

/**
 * Which directions to load, as two independent switches.
 *
 * Deliberately not a three-valued mode. "Download", "upload" and "both" are
 * three names for two switches, and naming the combination separately means
 * every consumer has to remember that `both` implies the other two — which is
 * exactly the kind of thing that drifts apart between the engine, the buttons
 * and the graph. At least one must be on; `Monitor` refuses an empty pair
 * rather than silently running a test that measures nothing.
 */
export interface Directions {
  readonly down: boolean;
  readonly up: boolean;
}

/** Both directions, the mode worth being careful about. */
export function isBidirectional(directions: Directions): boolean {
  return directions.down && directions.up;
}

/** Names a pair for announcements and messages. */
export function describeDirections(directions: Directions): string {
  if (isBidirectional(directions)) return 'download and upload together';
  if (directions.down) return 'download';
  if (directions.up) return 'upload';
  return 'nothing';
}

export interface MonitorUpdate {
  readonly directions: Directions;
  readonly elapsedMs: number;
  /** Throughput over a short trailing window. */
  readonly downMbps: number;
  readonly upMbps: number;
  /** Throughput over the whole session, excluding the ramp-up. */
  readonly avgDownMbps: number;
  readonly avgUpMbps: number;
  readonly downBytes: number;
  readonly upBytes: number;
}

export interface MonitorHandlers {
  /** Called on every engine tick, for the live readouts. */
  readonly onUpdate: (update: MonitorUpdate) => void;
  /** Called when a point is appended to the graph. */
  readonly onSample: (series: TimeSeries) => void;
  /** Called once if the session ends because the link failed. */
  readonly onError: (message: string) => void;
}

/** How often a point is added to the graph. */
export const SAMPLE_MS = 1000;

/** Points kept before the series halves its own resolution. */
const CAPACITY = 600;

const IDLE: TransferTick = { liveMbps: 0, averageMbps: 0, bytes: 0, progress: 0 };

type Key = 'down' | 'up';

/**
 * One direction of a session.
 *
 * Each has its own abort controller so it can be switched off — and back on —
 * without disturbing the other or the graph. That is the whole reason the legs
 * are objects rather than two branches inside `start`: a direction the visitor
 * turns off mid-session has to stop loading the link while the session, the
 * clock and the history carry on.
 */
class Leg {
  private controller: AbortController | null = null;
  private tick: TransferTick = IDLE;
  /** Bytes moved by earlier stints, so a restart does not reset the total. */
  private carried = 0;
  private everRan = false;

  constructor(
    readonly key: Key,
    private readonly spawn: (signal: AbortSignal, onTick: (tick: TransferTick) => void) => Promise<unknown>,
  ) {}

  get running(): boolean {
    return this.controller !== null;
  }

  /** Whether this direction was measured at any point in the session. */
  get measured(): boolean {
    return this.everRan;
  }

  /** The live rate. A direction that is switched off is carrying nothing. */
  get liveMbps(): number {
    return this.controller ? this.tick.liveMbps : 0;
  }

  get averageMbps(): number {
    return this.tick.averageMbps;
  }

  get bytes(): number {
    return this.carried + this.tick.bytes;
  }

  start(onTick: () => void, onFail: (error: unknown) => void): Promise<unknown> {
    if (this.controller) return Promise.resolve();
    const controller = new AbortController();
    this.controller = controller;
    this.everRan = true;
    this.tick = IDLE;

    return this.spawn(controller.signal, (tick) => {
      // A tick that arrives after this stint was stopped belongs to a run the
      // visitor has already switched off; letting it through would revive the
      // reading a moment after the line was supposed to end.
      if (this.controller !== controller) return;
      this.tick = tick;
      onTick();
    })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) onFail(error);
      })
      .finally(() => {
        if (this.controller === controller) {
          this.carried += this.tick.bytes;
          this.tick = IDLE;
          this.controller = null;
        }
      });
  }

  stop(): void {
    this.controller?.abort();
  }
}

export class Monitor {
  private running = false;
  private readonly series = new TimeSeries(CAPACITY, SAMPLE_MS);
  private readonly legs: Record<Key, Leg>;

  private startedAt = 0;
  /**
   * Where this stint's samples land on the session's timeline.
   *
   * Stopping and starting again resumes the same graph rather than throwing it
   * away: a monitor you paused to look at something is the ordinary case, and
   * losing an hour of history to a misplaced click is not a reasonable price.
   * Each stint continues after the last sample, so the timeline stays ordered
   * and the gap where nothing was measured is visible as one.
   */
  private timeBase = 0;
  /** Wall clock, for exports: `performance.now` has no calendar behind it. */
  private startedWallClock = new Date();
  private sampler: ReturnType<typeof setInterval> | null = null;
  private handlers: MonitorHandlers | null = null;
  private finished: (() => void) | null = null;

  constructor(
    private readonly params: TestParams,
    private readonly base = '',
    /** The server-side run these transfers belong to, if one was opened. */
    private readonly runId?: string,
  ) {
    const overhead = params.overhead_factor || 1;
    const graceMs = params.grace_seconds * 1000;

    this.legs = {
      down: new Leg('down', (signal, onTick) =>
        new DownloadPhase({
          base: this.base,
          ...(this.runId ? { run: this.runId } : {}),
          streams: params.download_streams,
          durationMs: Infinity,
          graceMs,
          overhead,
          signal,
          onTick,
        }).run(),
      ),
      up: new Leg('up', (signal, onTick) =>
        new UploadPhase({
          base: this.base,
          ...(this.runId ? { run: this.runId } : {}),
          streams: params.upload_streams,
          durationMs: Infinity,
          graceMs,
          overhead,
          signal,
          // Sized from what the link has actually shown it can do, the way
          // the staged run does. A fixed chunk is wrong at both ends: too
          // small on a fast link, where per-request turnaround eats the
          // measurement, and too large on a slow one, where a single request
          // outlasts the window it is being measured in.
          chunkBytes: this.uploadChunkBytes(),
          onTick,
        }).run(),
      ),
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  get history(): TimeSeries {
    return this.series;
  }

  /** When the session began, in wall-clock time, for exported timestamps. */
  get startedOn(): Date {
    return this.startedWallClock;
  }

  /** Position on the session timeline now, for a graph that scrolls smoothly. */
  get elapsedMs(): number {
    if (this.running) return this.timeBase + (performance.now() - this.startedAt);
    return this.series.last?.t ?? 0;
  }

  /** Throws the history away, for starting a genuinely new session. */
  clear(): void {
    if (this.running) return;
    this.series.clear();
    this.timeBase = 0;
  }

  /** Which directions are loading the link right now. */
  get directions(): Directions {
    return { down: this.legs.down.running, up: this.legs.up.running };
  }

  /** Which directions were measured at any point, for an export's columns. */
  get everMeasured(): Directions {
    return { down: this.legs.down.measured, up: this.legs.up.measured };
  }

  /**
   * An upload chunk sized so one request lasts a few hundred milliseconds on
   * this link, falling back to the configured size until there is a figure to
   * go on.
   */
  private uploadChunkBytes(): number {
    const observed = Math.max(this.legs.up.averageMbps, this.legs.down.averageMbps);
    if (!Number.isFinite(observed) || observed <= 0) return this.params.upload_chunk_bytes;
    const perStream = (observed * 1e6) / 8 / Math.max(1, this.params.upload_streams);
    // Half a second per request; `UploadPhase` clamps to its own bounds. A
    // shorter target makes request turnaround, rather than the link, decide
    // the figure.
    return Math.round(perStream * 0.5);
  }

  /** The live readings; a direction that is switched off reads zero. */
  private reading(): { down: number; up: number } {
    return { down: this.legs.down.liveMbps, up: this.legs.up.liveMbps };
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.legs.down.stop();
    this.legs.up.stop();
  }

  /**
   * Turns a direction on or off while the session runs.
   *
   * The session itself is untouched: the clock keeps running, the history
   * keeps its shape, and the direction that stays on is not interrupted. A
   * direction switched off records `null` rather than zero from then on, so
   * the graph shows a gap instead of claiming the link carried nothing.
   *
   * Switching everything off is allowed: the session stays open with its
   * clock and its graph running, measuring nothing, which is a real thing to
   * want — let the link settle and watch what it does unloaded.
   */
  setDirections(next: Directions): void {
    if (!this.running) return;
    for (const key of ['down', 'up'] as const) {
      const leg = this.legs[key];
      if (next[key] && !leg.running) void this.runLeg(leg);
      else if (!next[key] && leg.running) leg.stop();
    }
    this.emit();
  }

  /**
   * Runs until `stop`, then resolves. Rejects for nothing: a link that fails
   * is reported through `onError` and ends the session, because a monitor that
   * throws after ten minutes has thrown away ten minutes of graph.
   */
  async start(directions: Directions, handlers: MonitorHandlers): Promise<void> {
    if (this.running) return;
    if (!directions.down && !directions.up) {
      throw new RangeError('Monitor: at least one direction must be selected');
    }

    this.running = true;
    this.handlers = handlers;
    const last = this.series.last;
    // Resuming continues the timeline; a fresh session starts it. The wall
    // clock is only taken on a fresh one, so exported timestamps stay true to
    // when the *session* began rather than to the latest resume.
    this.timeBase = last ? last.t + SAMPLE_MS : 0;
    if (!last) this.startedWallClock = new Date();
    this.startedAt = performance.now();

    this.sampler = setInterval(() => this.sample(), SAMPLE_MS);

    const done = new Promise<void>((resolve) => {
      this.finished = resolve;
    });

    if (directions.down) void this.runLeg(this.legs.down);
    if (directions.up) void this.runLeg(this.legs.up);

    await done;

    if (this.sampler !== null) clearInterval(this.sampler);
    this.sampler = null;
    // One last point, so a session stopped between samples still ends on the
    // graph where it ended in fact.
    this.sample();
    this.emit();
    this.handlers = null;
  }

  private async runLeg(leg: Leg): Promise<void> {
    await leg.start(
      () => this.emit(),
      (error) => {
        this.handlers?.onError(describeError(error));
        // A direction that has failed is not coming back on its own, and a
        // session with no direction left is over.
        this.stop();
      },
    );
    // The session ends when nothing is loading the link any more — whether
    // that is the visitor stopping it or the last leg failing.
    if (!this.legs.down.running && !this.legs.up.running) {
      this.running = false;
      this.finished?.();
      this.finished = null;
    }
  }

  private sample(): void {
    const { down, up } = this.reading();
    this.series.add({ t: this.timeBase + (performance.now() - this.startedAt), down, up });
    this.handlers?.onSample(this.series);
  }

  private emit(): void {
    const { down, up } = this.reading();
    this.handlers?.onUpdate({
      directions: this.directions,
      elapsedMs: this.elapsedMs,
      downMbps: down,
      upMbps: up,
      avgDownMbps: this.legs.down.averageMbps,
      avgUpMbps: this.legs.up.averageMbps,
      downBytes: this.legs.down.bytes,
      upBytes: this.legs.up.bytes,
    });
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
