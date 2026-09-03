import type { ApiClient, Submission } from '../../api';
import type { Peer, StoredResult, TestParams } from '../../domain/types';
import { SpeedTest, type Phase, type Snapshot } from '../../engine/runner';
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

  constructor(private readonly deps: TestControllerDeps) {}

  get isRunning(): boolean {
    return this.test !== null;
  }

  abort(): void {
    this.test?.abort();
  }

  /** @param peer The selected backend, or null for this server. */
  async run(peer: Peer | null): Promise<void> {
    if (this.test) return;

    const { stats, visual, setRunning } = this.deps;
    const target = visual();

    stats.reset();
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
      }
      this.applySnapshot(s, target);
    });

    this.test = null;
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
    // However the run ended, the machine returns the car to the ground floor.
    // Nothing waits for it: the results are read while the car comes home.
    visual.park();
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
