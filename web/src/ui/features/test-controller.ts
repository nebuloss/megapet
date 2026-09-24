import type { ApiClient, Submission } from '../../api';
import type { Peer, StoredResult, TestParams } from '../../domain/types';
import { SpeedTest, type Phase, type Snapshot } from '../../engine/runner';
import { TimeSeries } from '../../engine/series';
import type { Directions } from '../../engine/monitor';

/** How often a run is sampled for the graph. */
const SAMPLE_MS = 250;

/** Running, but between phases: nothing is loading the link this instant. */
const NOTHING: Directions = { down: false, up: false };

/** What each phase is doing to the link, for the manual mode's switches. */
const LOADS: Partial<Record<Phase, Directions>> = {
  download: { down: true, up: false },
  upload: { down: false, up: true },
};
import { describePlatform, formatMs, formatRate } from '../primitives/format';
import type { IconName } from '../primitives/icons';
import type { Drive, GaugeAccent, SpeedVisual } from '../visuals';
import type { StatKey, StatTiles } from './stat-tiles';

/** How each measuring phase presents itself. */
interface PhaseStyle {
  readonly label: string;
  readonly icon: IconName;
  readonly accent: GaugeAccent;
  readonly unit: string;
  readonly tile: StatKey | null;
  /** Which way the lift travels while this phase runs. */
  readonly drive: Drive;
}

/**
 * `reversing` is absent deliberately: its direction comes from the phase it is
 * setting up, so it cannot be described by a static entry.
 */
/** Screen readers should hear the unit, not spell it. */
const SPOKEN: Readonly<Record<string, string>> = {
  Gbps: 'gigabits per second',
  Mbps: 'megabits per second',
  kbps: 'kilobits per second',
  bps: 'bits per second',
};

function spoken(mbps: number): string {
  const rate = formatRate(mbps);
  return `${rate.value} ${SPOKEN[rate.unit] ?? rate.unit}`;
}

const PHASES: Partial<Record<Phase, PhaseStyle>> = {
  latency: {
    label: 'Latency', icon: 'latency', accent: 'secondary',
    unit: 'ms', tile: 'ping', drive: 'up',
  },
  // Bytes coming down the wire send the car down the shaft; going back up for
  // the upload phase is what the belt gets crossed for.
  download: {
    label: 'Download', icon: 'download', accent: 'primary',
    unit: 'Mbps', tile: 'download', drive: 'down',
  },
  upload: {
    label: 'Upload', icon: 'upload', accent: 'tertiary',
    unit: 'Mbps', tile: 'upload', drive: 'up',
  },
};

export interface TestControllerDeps {
  readonly api: ApiClient;
  readonly params: TestParams;
  readonly storeEnabled: boolean;
  readonly stats: StatTiles;
  /** Resolved on each run, because the mounted visual can be swapped. */
  readonly visual: () => SpeedVisual;
  readonly setRunning: (running: boolean) => void;
  /** Screen-reader announcement. */
  readonly announce: (message: string) => void;
  /** User-visible transient message. */
  readonly notify: (message: string) => void;
  readonly onSaved: (result: StoredResult) => void;
  /**
   * Reports what the run is loading the link with right now, or null when it
   * is not running.
   *
   * Richer than a boolean because the manual mode's switches show it: while a
   * staged run is in its upload phase the upload switch should read as on,
   * because it is — the link really is being driven that way, just by the
   * other test. Saying only "something is running" would leave both switches
   * showing the visitor's own stale setting.
   */
  readonly onActivity: (directions: Directions | null) => void;
  /** Fires as each point is recorded, so a visible graph can follow along. */
  readonly onSample: () => void;
  /**
   * The reading right now, on every snapshot rather than every sample.
   *
   * A graph drawing this run needs the live figure, not the last one it
   * recorded: chasing the recorded sample draws a flat stub out to the
   * leading edge and then steps when the next sample lands, which is the
   * opposite of what the leading edge is for.
   */
  readonly onLive: (down: number, up: number) => void;
}

/**
 * Runs a test and translates its progress into the UI.
 *
 * This is the only place that knows how a measurement phase maps onto a visual
 * and a set of tiles. The engine reports snapshots and knows nothing about the
 * DOM; the views know nothing about phases. Keeping the translation in one
 * class is what lets either side change without disturbing the other.
 */
export class TestController {
  private test: SpeedTest | null = null;
  /**
   * Every run so far, sampled as it happens, on one timeline.
   *
   * A staged run has always known its throughput second by second; it simply
   * had nowhere to show it. Runs **accumulate** rather than replacing each
   * other, so a morning's worth of spot checks can be read as a single graph
   * with each run's download and upload standing up in turn — which is the
   * question "is it slow right now, or has it been slow all week" asked in
   * the only form that can answer it.
   */
  private readonly recording = new TimeSeries(600, 250);
  private recordedAt = 0;
  private recordedPhase: Phase = 'idle';
  private timeline = 0;

  constructor(private readonly deps: TestControllerDeps) {}

  get isRunning(): boolean {
    return this.test !== null;
  }

  /** The last staged run as a graph, or null if nothing has been measured. */
  get lastRun(): TimeSeries | null {
    return this.recording.all.length > 0 ? this.recording : null;
  }

  abort(): void {
    this.test?.abort();
  }

  /** @param peer The selected backend, or null for this server. */
  async run(peer: Peer | null): Promise<void> {
    if (this.test) return;

    const { stats, visual, setRunning } = this.deps;
    const target = visual();

    this.deps.onActivity(NOTHING);
    stats.reset();
    this.beginRecording();
    target.reset();
    target.setActive(true);
    setRunning(true);

    const base = peer ? this.deps.api.withBase(peer.url) : this.deps.api;
    // Both are asked after reset(), so they describe the moves it just began.
    // open() starts the car up the shaft; it queues behind the settle, so the
    // ping is taken while the car rides rather than while the needle falls.
    this.test = new SpeedTest(this.deps.params, base.url(''), {
      openingMs: target.settleMs(),
      latencyMs: target.open(),
      reverseMs: target.transitionMs,
    });

    let lastPhase: Phase = 'idle';
    const snapshot = await this.test.run((s) => {
      if (s.phase !== lastPhase) {
        lastPhase = s.phase;
        this.applyPhase(s, target);
        this.deps.onActivity(LOADS[s.phase] ?? NOTHING);
      }
      this.applySnapshot(s, target);
    });

    this.test = null;
    this.endRecording();
    this.deps.onActivity(null);
    target.setActive(false);
    setRunning(false);
    stats.setActive(null);

    await this.finish(snapshot, target, peer);
  }

  private async finish(
    snapshot: Snapshot,
    visual: SpeedVisual,
    peer: Peer | null,
  ): Promise<void> {
    // However the run ended, the machine goes back to rest: the car to the
    // ground floor and the accent to its resting colour, which the upload
    // phase would otherwise leave on tertiary. Nothing waits for the car —
    // the results are read while it comes home.
    visual.park();
    visual.setAccent('primary');
    if (snapshot.phase === 'error') {
      visual.setPhase('Failed', 'close');
      this.deps.announce('The test failed.');
      this.deps.notify(snapshot.error ?? 'The test failed.');
      return;
    }
    if (snapshot.phase === 'aborted') {
      visual.setPhase('Stopped', 'stop');
      this.deps.announce('Test stopped.');
      return;
    }

    visual.setPhase('Complete', 'check');
    this.deps.announce(
      `Test complete. Download ${spoken(snapshot.downloadMbps)}, ` +
        `upload ${spoken(snapshot.uploadMbps)}, ping ${formatMs(snapshot.pingMs)} milliseconds.`,
    );
    await this.persist(snapshot, peer);
  }

  private applyPhase(snapshot: Snapshot, visual: SpeedVisual): void {
    if (snapshot.phase === 'reversing') {
      // The leg that just ended finishes properly first: the car runs into its
      // floor, and only then is the drive reversed for the next one.
      visual.land();
      // Selected before the reading is applied, so the shift re-anchors on
      // where the car actually is rather than moving it.
      visual.setDrive(snapshot.nextPhase === 'download' ? 'down' : 'up');
      visual.setAccent('secondary');
      visual.setPhase('Reversing', 'replay');
      visual.setReading(null, 'Mbps');
      this.deps.stats.setActive(null);
      this.deps.announce(`Reversing the drive for the ${snapshot.nextPhase ?? 'next'} test.`);
      return;
    }

    const style = PHASES[snapshot.phase];
    if (!style) return;
    visual.setDrive(style.drive);
    visual.setAccent(style.accent);
    visual.setPhase(style.label, style.icon);
    visual.setReading(style.unit === 'ms' ? 0 : null, style.unit);
    this.deps.stats.setActive(style.tile);
    this.deps.announce(`${style.label} test running.`);
  }

  private applySnapshot(snapshot: Snapshot, visual: SpeedVisual): void {
    this.record(snapshot);
    this.deps.onLive(
      snapshot.phase === 'download' ? snapshot.liveMbps : 0,
      snapshot.phase === 'upload' ? snapshot.liveMbps : 0,
    );
    visual.setProgress(snapshot.progress);

    if (snapshot.phase === 'reversing') {
      // The reading is pinned at zero here so the machine can be seen changing
      // over; the tiles keep whatever the last phase measured.
      visual.setPosition(0);
      return;
    }

    if (snapshot.phase === 'latency') {
      // Milliseconds have no place on a throughput scale, so the lift stays
      // put and only the readout tracks the probe.
      visual.setReading(snapshot.pingMs, 'ms');
      visual.setPosition(0);
      this.deps.stats.set('ping', formatMs(snapshot.pingMs));
      return;
    }

    visual.setReading(null, 'Mbps');
    visual.setPosition(snapshot.liveMbps);
    const down = formatRate(snapshot.downloadMbps);
    const up = formatRate(snapshot.uploadMbps);
    this.deps.stats.set('download', down.value, down.unit);
    this.deps.stats.set('upload', up.value, up.unit);
    this.deps.stats.set('ping', formatMs(snapshot.pingMs));
    this.deps.stats.set('jitter', formatMs(snapshot.jitterMs));
  }

  /**
   * Samples the run for the monitor's graph.
   *
   * Throttled to the series' own resolution rather than recording every
   * snapshot: the engine emits far faster than a graph can show, and a
   * recording that compacts twice during a ten-second run would lose the shape
   * it exists to keep. The phase decides which direction the reading belongs
   * to, so a download never lands in the upload line.
   */
  private record(snapshot: Snapshot): void {
    // Every phase is sampled, not just the measuring ones. Skipping latency
    // and the reversals left a gap of several seconds with no points in it,
    // which the graph then drew as a long diagonal from the end of the
    // download to the start of the upload — a decay that never happened.
    // Recording the floor through those phases makes each leg stand up as
    // what it is.
    if (snapshot.phase === 'idle' || snapshot.phase === 'done') return;
    const now = performance.now();

    // A phase change is the one sample that must never be thrown away. The
    // reversal emits a single zero the instant the download ends and then
    // says nothing for several seconds, so letting the throttle drop it left
    // the graph with a five-second gap that the curve drew straight through
    // as a long, gentle decline the link never performed.
    const turned = snapshot.phase !== this.recordedPhase;
    if (!turned && this.recordedAt !== 0 && now - this.recordedAt < SAMPLE_MS) return;
    this.recordedPhase = snapshot.phase;
    this.timeline += this.recordedAt === 0 ? 0 : now - this.recordedAt;
    this.recordedAt = now;
    this.recording.add({
      t: this.timeline,
      down: snapshot.phase === 'download' ? snapshot.liveMbps : 0,
      up: snapshot.phase === 'upload' ? snapshot.liveMbps : 0,
    });
    this.deps.onSample();
  }

  /**
   * Opens a gap before a new run.
   *
   * The idle time between runs is not drawn to scale — an afternoon between
   * two tests would leave both squeezed into a pixel — so runs are butted up
   * against each other with a floor sample between them. That keeps each run
   * legible and still says, unambiguously, that they are separate runs.
   */
  private beginRecording(): void {
    this.recordedPhase = 'idle';
    if (this.recording.all.length > 0) {
      this.timeline += SAMPLE_MS;
      this.recording.add({ t: this.timeline, down: 0, up: 0 });
      this.timeline += SAMPLE_MS;
    }
    this.recordedAt = 0;
  }

  /** Closes a run off at the floor, so the next one starts from nothing. */
  private endRecording(): void {
    if (this.recording.all.length === 0) return;
    this.timeline += SAMPLE_MS;
    this.recording.add({ t: this.timeline, down: 0, up: 0 });
  }

  private async persist(snapshot: Snapshot, peer: Peer | null): Promise<void> {
    if (!this.deps.storeEnabled) return;

    const body: Submission = {
      download_mbps: snapshot.downloadMbps,
      upload_mbps: snapshot.uploadMbps,
      ping_ms: snapshot.pingMs,
      jitter_ms: snapshot.jitterMs,
      ping_min_ms: snapshot.pingMinMs,
      ping_max_ms: snapshot.pingMaxMs,
      download_bytes: snapshot.downloadBytes,
      upload_bytes: snapshot.uploadBytes,
      platform: describePlatform(),
      server_id: peer?.id ?? '',
      server_name: peer?.name ?? 'This server',
      note: '',
    };

    try {
      // Always saved to this server, whichever backend was measured against.
      this.deps.onSaved(await this.deps.api.saveResult(body));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.deps.notify(`Result not saved: ${detail}`);
    }
  }
}
