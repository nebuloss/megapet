import { Component } from '../../core';
import { downloadCsv, exportFilename, toCsv } from '../../engine/export';
import {
  Monitor,
  describeDirections,
  isBidirectional,
  type Directions,
  type MonitorUpdate,
} from '../../engine/monitor';
import type { TimeSeries } from '../../engine/series';
import type { Peer, TestParams } from '../../domain/types';
import { el, hydrateRipples } from '../primitives/dom';
import { formatRate } from '../primitives/format';
import { icon } from '../primitives/icons';
import { Treadmill, jogMarkup } from '../visuals/jog';
import { LeadingEdge } from '../visuals/leading-edge';
import {
  areaPath,
  formatBytes,
  formatElapsed,
  formatSpan,
  gridLines,
  hasData,
  linePath,
  yFor,
  timeTicks,
  visible,
  AXIS_GUTTER,
  UNIT,
  type GraphView,
} from '../visuals/graph';
import { GraphViewport } from '../visuals/viewport';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Zoom glyphs. Local because they mean nothing outside this panel. */
const ZOOM_OUT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M8 11h6M15.5 15.5L20 20"/></svg>';
const ZOOM_IN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M8 11h6M11 8v6M15.5 15.5L20 20"/></svg>';

/**
 * Fallback drawing size, used only until the element has been laid out.
 *
 * The viewBox is otherwise kept equal to the chart's size in CSS pixels. The
 * obvious alternative — a fixed viewBox stretched to fit with
 * `preserveAspectRatio="none"` — scales the axis labels horizontally along
 * with everything else, and a stretched digit is immediately obvious.
 */
const VIEW = { width: 640, height: 224 };

type DirectionKey = 'down' | 'up';

interface Readout {
  readonly root: HTMLElement;
  readonly value: HTMLElement;
  readonly unit: HTMLElement;
}

export interface MonitorPanelDeps {
  readonly params: TestParams;
  /** Resolved per run, because the visitor can change server between runs. */
  readonly peer: () => Peer | null;
  readonly baseFor: (peer: Peer | null) => string;
  readonly notify: (message: string) => void;
  readonly announce: (message: string) => void;
  /** The most recent staged run, replayed as a graph until a session starts. */
  readonly recorded: () => TimeSeries | null;
  /** Fires when a session starts or ends, so the speed test can stand down. */
  readonly onRunningChange: (running: boolean) => void;
  /**
   * The current rates, for the page's stat tiles.
   *
   * On the main page the panel has no readouts of its own — it stands where
   * the dial stands, and the tiles beside it are the page's readout. Without
   * this they sat at a dash through a whole manual session while the link was
   * plainly busy.
   */
  readonly onReadings: (down: number, up: number) => void;
  /**
   * Starts or stops the staged run, for when the graph is showing auto mode.
   *
   * The graph belongs to both modes, so the button under it has to belong to
   * whichever mode is selected. Offering only manual's control there made auto
   * mode a thing you could look at the results of but not operate.
   */
  readonly onAutoToggle: (start: boolean) => void;
}

/**
 * The continuous monitor screen.
 *
 * Deliberately not built on `SpeedVisual`. That interface is a contract about
 * a staged run — settle, open, reverse, land — and none of those words mean
 * anything to a test with no phases and no end. The clinching case is running
 * both directions: a lift cannot travel up and down at once, so the honest
 * answer is a different visual rather than a lift asked to do something it
 * cannot.
 */
export class MonitorPanel extends Component<HTMLElement> {
  /** Replaced only when the selected server changes. */
  private monitor: Monitor;
  private monitorBase: string;
  private readonly startButton: HTMLButtonElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly toggles = new Map<DirectionKey, HTMLButtonElement>();
  private readonly readouts = new Map<string, Readout>();
  private readonly svg: SVGSVGElement;
  private readonly grid: SVGGElement;
  private readonly axis: SVGGElement;
  private readonly marker: SVGGElement;
  private focusButton!: HTMLButtonElement;
  private readonly downArea: SVGPathElement;
  private readonly downLine: SVGPathElement;
  private readonly upArea: SVGPathElement;
  private readonly upLine: SVGPathElement;
  private readonly spanLabel: HTMLElement;
  private readonly emptyNote: HTMLElement;
  private readonly warning: HTMLElement;
  private readonly treadmill: Treadmill;
  private rider!: SVGSVGElement;
  private readonly head: HTMLElement;
  private readonly title: HTMLElement;
  private readonly blurb: HTMLElement;
  private readonly controlsRow: HTMLElement;
  private readonly plot: HTMLElement;
  private readonly readoutGrid: HTMLElement;
  private readonly actions: HTMLElement;
  /** Compact trims the panel to fit the hero, where it stands in for the dial. */
  private compact = false;
  /** Whether the plot is shown. Independent of size: the graph is a view. */
  private showGraph = true;

  private directions: Directions = { down: true, up: false };
  private running = false;
  private blocked: 'speedtest' | null = null;
  /** Which mode's controls this panel is presenting. */
  private mode: 'auto' | 'manual' = 'manual';
  private autoRunning = false;
  /**
   * What the speed test is loading the link with, while it holds it.
   *
   * The switches show this instead of the visitor's own setting for as long as
   * it lasts, because it is the truth about the link: during a staged upload
   * the upload switch reads as on, and the graph beside it is drawing that
   * upload. Showing a stale setting next to a live graph is how a control
   * stops being believed.
   */
  private external: Directions | null = null;
  /** The newest reading, drawn at the leading edge between samples. */
  private live = { down: 0, up: 0 };
  /** Eases that leading point, so the line grows rather than stepping. */
  private readonly edge = { down: new LeadingEdge(), up: new LeadingEdge() };
  private lastDraw = 0;
  /** Zoom, pan and whether the window follows the live edge. */
  private readonly viewport = new GraphViewport();
  /** Size the grid was last ruled for, so it is not rebuilt every frame. */
  private gridKey = '';
  private axisKey = '';
  /** The chart's size in CSS pixels; the viewBox is kept equal to it. */
  private size = { ...VIEW };
  private frame: number | null = null;
  private readonly resize: ResizeObserver | null;

  constructor(private readonly deps: MonitorPanelDeps) {
    super(el('section', { class: 'monitor' }));
    this.monitorBase = deps.baseFor(deps.peer());
    this.monitor = new Monitor(deps.params, this.monitorBase);

    const chart = this.buildChart();
    this.svg = chart.svg;
    this.grid = chart.grid;
    this.axis = chart.axis;
    this.marker = chart.marker;
    this.downArea = chart.downArea;
    this.downLine = chart.downLine;
    this.upArea = chart.upArea;
    this.upLine = chart.upLine;
    this.spanLabel = chart.span;
    this.emptyNote = chart.empty;
    this.warning = chart.warning;

    this.startButton = el('button', {
      class: 'btn btn--start',
      type: 'button',
    }) as HTMLButtonElement;
    this.startButton.addEventListener('click', () => {
      if (this.mode === 'auto') this.deps.onAutoToggle(!this.autoRunning);
      else this.toggle();
    });

    this.exportButton = el('button', {
      class: 'btn btn--outlined',
      type: 'button',
      html: icon('download'),
    }) as HTMLButtonElement;
    this.exportButton.append(document.createTextNode('Export CSV'));
    this.exportButton.addEventListener('click', () => this.exportCsv());

    // History now survives stopping, so there has to be a way to be rid of it.
    this.clearButton = el('button', {
      class: 'btn btn--text',
      type: 'button',
      html: icon('close'),
    }) as HTMLButtonElement;
    this.clearButton.append(document.createTextNode('Clear'));
    this.clearButton.addEventListener('click', () => {
      this.monitor.clear();
      this.refresh();
    });

    this.title = el('h2', { class: 'section__title' }, 'Manual mode');
    this.head = el('div', { class: 'monitor__head' }, this.title);
    this.blurb = el(
      'p',
      { class: 'monitor__blurb' },
      'Loads the link until you stop it, and plots what it does. Useful for ' +
        'catching the dips a ten-second test runs straight past.',
    );
    this.controlsRow = chart.controls;
    this.plot = chart.plot;
    this.readoutGrid = this.buildReadouts();
    this.actions = el('div', { class: 'monitor__actions' });

    // Built before the first layout, which places him and sets his pace.
    this.treadmill = this.buildRider();
    this.layOut();

    this.setRunning(false);
    this.paintDirections();
    this.measure();
    this.refresh();
    hydrateRipples(this.root);

    // The chart is sized in pixels, so a window resize changes its geometry
    // rather than merely stretching it.
    this.resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (this.measure()) this.refresh();
          });
    this.resize?.observe(this.svg);
    this.bindPanning(this.svg);
  }

  override destroy(): void {
    this.stopFrames();
    this.treadmill.destroy();
    this.resize?.disconnect();
    this.monitor.stop();
  }

  /**
   * Chooses between the two places this panel appears.
   *
   * Compact is the main page in manual mode, where it stands in for the speed
   * dial: the switches and the start button, and a way through to the graph.
   * Full is the graph page. One instance, laid out twice, so a session started
   * from either keeps running when the other is shown.
   */
  /**
   * Names the graph for whoever filled it.
   *
   * On the graph page the panel is the record of both modes, so heading it
   * "Manual mode" while the Auto tab is selected contradicts the tabs right
   * above it.
   */
  setTitle(text: string): void {
    this.title.textContent = text;
  }

  /**
   * Presents one mode's controls.
   *
   * Only meaningful on the graph page: in the hero the panel is *only* shown
   * for manual mode, because auto has its own dial there.
   */
  setMode(mode: 'auto' | 'manual'): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.paintDirections();
    this.setRunning(this.running);
  }

  /** The staged run's current reading, for the leading edge and the readouts. */
  setExternalLive(down: number, up: number): void {
    if (this.blocked === null) return;
    // A direction the run has finished with is at zero, and the eased edge
    // must be told so at once rather than left to coast down from its last
    // reading — that coast drew a long decay after the download leg that the
    // link never performed.
    if (down === 0) this.edge.down.reset();
    if (up === 0) this.edge.up.reset();
    this.live = { down, up };
    this.setRate('down', down);
    this.setRate('up', up);
    this.setRate('both', down + up);
    this.treadmill.setRate(down + up);
  }

  /** Tracks the staged run, so the auto button can offer to stop it. */
  setAutoRunning(running: boolean): void {
    this.autoRunning = running;
    this.setRunning(this.running);
  }

  setCompact(compact: boolean): void {
    if (this.compact === compact) return;
    this.compact = compact;
    this.layOut();
    this.measure();
    this.refresh();
  }

  /**
   * Shows or hides the plot.
   *
   * The graph is a *view* of a test, not a place with its own controls: the
   * mode, the buttons, the tiles and the history are the same either way, and
   * only the picture in the middle changes. Keeping it a flag rather than a
   * screen is what stops the two drifting apart, which is how the graph ended
   * up offering manual's controls while auto mode was selected.
   */
  setShowGraph(show: boolean): void {
    if (this.showGraph === show) return;
    this.showGraph = show;
    this.layOut();
    this.measure();
    this.refresh();
  }

  private layOut(): void {
    this.root.dataset.compact = String(this.compact);
    this.root.dataset.graph = String(this.showGraph);
    // Export and Clear act on the recorded history, so they belong wherever
    // that history is on show.
    this.actions.replaceChildren(
      this.startButton,
      ...(this.showGraph ? [this.exportButton, this.clearButton] : []),
    );
    // The graph is the thing to look at when it is showing, and a running
    // mascot beside a line you are reading is one moving thing too many.
    this.head.replaceChildren(
      ...(this.showGraph ? [] : [this.rider]),
      this.title,
    );
    this.treadmill.setActive(!this.showGraph && (this.running || this.blocked !== null));

    this.root.replaceChildren(
      this.head,
      ...(this.compact ? [] : [this.blurb]),
      this.controlsRow,
      ...(this.showGraph ? [this.plot] : []),
      this.warning,
      // Shown with the graph, wherever the graph is. This used to also require
      // a non-compact panel, which stopped being reachable when the graph
      // became a view of the one page — so the figures beside the plot
      // silently disappeared.
      ...(this.showGraph ? [this.readoutGrid] : []),
      this.actions,
    );
  }

  /** Stops a session without tearing the panel down, for leaving the screen. */
  stop(): void {
    this.monitor.stop();
  }

  /**
   * Redraws from whatever history is worth showing.
   *
   * With no session of its own the panel shows the last staged run, so
   * arriving here after a speed test shows that test rather than an empty
   * frame — the graph the ten-second run was already collecting but had
   * nowhere to display.
   */
  refresh(): void {
    this.draw(this.source());
  }

  /**
   * Where the leading point sits on the timeline.
   *
   * This panel's own session has a clock; a staged run does not share one, so
   * its edge advances from the last sample it recorded. Either way the point
   * is ahead of the newest sample, which is what lets the line grow between
   * samples instead of jumping when each one lands.
   */
  private elapsedFor(series: TimeSeries): number {
    if (this.running) return this.monitor.elapsedMs;
    const last = series.last;
    if (!last) return 0;
    // Only a *running* test has a clock still moving. Advancing from the last
    // sample unconditionally meant the timeline kept growing after a run had
    // finished, so a stopped graph scrolled itself off into empty axis and
    // "follow" returned to a `now` that no longer contained any data.
    if (this.blocked === null) return last.t;
    return last.t + (performance.now() - series.updatedAt);
  }

  private source(): TimeSeries {
    if (this.running) return this.monitor.history;
    const recorded = this.deps.recorded();
    if (!recorded || recorded.all.length === 0) return this.monitor.history;
    if (this.monitor.history.all.length === 0) return recorded;
    // Both hold something: show whichever was measured most recently, which is
    // what the visitor was last doing. Preferring the monitor's own history
    // unconditionally meant a session from earlier hid the staged runs made
    // since, and the graph looked frozen.
    return recorded.updatedAt > this.monitor.history.updatedAt
      ? recorded
      : this.monitor.history;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ---------------------------------------------------------------- running --

  private toggle(): void {
    if (this.running) {
      this.monitor.stop();
      return;
    }
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.setRunning(true);
    this.emptyNote.hidden = true;

    const directions = this.directions;
    this.deps.announce(`Manual mode started: ${describeDirections(directions)}.`);

    // The same monitor is reused, so stopping and starting resumes its graph
    // rather than discarding it. A different server is a different
    // measurement, though, so pointing somewhere else starts a fresh one
    // instead of splicing two links into one timeline.
    const base = this.deps.baseFor(this.deps.peer());
    if (base !== this.monitorBase) {
      this.monitor = new Monitor(this.deps.params, base);
      this.monitorBase = base;
    }
    const monitor = this.monitor;

    this.startFrames();
    await monitor.start(directions, {
      onUpdate: (update) => this.applyUpdate(update),
      // Drawing is driven by the frame loop, not by samples: a redraw once a
      // second is a graph that visibly steps.
      onSample: () => {},
      onError: (message) => this.deps.notify(`Monitor stopped: ${message}`),
    });
    this.stopFrames();
    // Cleared first, then drawn: a final redraw taken while the panel still
    // believed it was running left the live-speed markers ruled across a
    // stopped graph, pointing at a reading that no longer existed.
    this.setRunning(false);
    this.refresh();
    this.deps.announce('Manual mode stopped.');
  }

  /**
   * Redraws every frame while a session runs.
   *
   * The history only gains a point a second, but the graph has to move
   * continuously: the axis scrolls with the clock, and the newest reading is
   * drawn as a provisional point at 'now' that slides rightwards until the
   * sample behind it lands. Redrawing only when a sample arrives is what made
   * the line jump once a second.
   */
  private startFrames(): void {
    if (this.frame !== null) return;
    const step = (): void => {
      // Rescheduled before the work, never after it. A throw used to leave
      // `frame` set with nothing scheduled, so the loop was dead and could
      // never be restarted — the graph froze while the readouts beside it
      // carried on, which is exactly as confusing as it sounds.
      this.frame = requestAnimationFrame(step);
      this.refresh();
    };
    this.frame = requestAnimationFrame(step);
  }

  private stopFrames(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /**
   * Blocks starting a session while the staged test holds the link.
   *
   * Both would be measuring a link the other is already saturating, so only
   * one may run. Disabling the button and saying why is better than letting
   * the click through and then asking.
   */
  setBlocked(reason: 'speedtest' | null, directions: Directions | null = null): void {
    this.blocked = reason;
    this.external = reason === null ? null : directions;
    this.paintDirections();
    // Re-evaluates the treadmill too: `blocked` is half of what decides it.
    this.setRunning(this.running);
    // The graph follows whichever test is loading the link, so the frame loop
    // belongs to either of them running rather than only to this one.
    if (this.blocked !== null || this.running) this.startFrames();
    else {
      this.stopFrames();
      this.refresh();
    }
  }

  /** The directions to display: the link's real state wins over the setting. */
  private shown(): Directions {
    return this.external ?? this.directions;
  }

  private setRunning(running: boolean): void {
    const changed = this.running !== running;
    this.running = running;
    this.root.dataset.running = String(running);
    // He runs for whichever test is loading the link. Tying him to this
    // panel's own session left him standing still through a whole staged run
    // that was drawing a graph right underneath him.
    this.treadmill.setActive(!this.showGraph && (running || this.blocked !== null));
    if (changed) this.deps.onRunningChange(running);
    // The switches say "Measuring" rather than "On" while a session runs, so
    // they have to be repainted when that changes and not only when pressed.
    this.paintDirections();
    // In auto mode this button is the speed test's own control, so it is never
    // the one that has to stand aside.
    if (this.mode === 'auto') {
      this.startButton.disabled = false;
      this.startButton.innerHTML = icon(this.autoRunning ? 'stop' : 'speed');
      this.startButton.append(document.createTextNode(this.autoRunning ? 'Stop' : 'Start test'));
      this.startButton.title = '';
      return;
    }

    const idle = !this.directions.down && !this.directions.up;
    const blocked = this.blocked !== null && !running;
    // A session with nothing selected is allowed: it records an idle link,
    // which is the baseline a later reading is read against.
    this.startButton.disabled = blocked;
    this.startButton.innerHTML = icon(running ? 'stop' : 'speed');
    // "Resume" once there is a graph to continue, because that is what it does.
    const idleLabel = this.monitor.history.all.length > 0 ? 'Resume' : 'Start monitoring';
    this.startButton.append(
      document.createTextNode(
        running
          ? 'Pause'
          : blocked
            ? 'Speed test running'
            : idle
              ? 'Watch idle link'
              : idleLabel,
      ),
    );
    // Names the shortcut where the control is, which is the only place
    // anyone looks for one.
    this.startButton.title = blocked
      ? 'Wait for the speed test to finish — both would be measuring the same link.'
      : 'Space';
    this.updateExportButton();
  }

  private exportCsv(): void {
    const points = this.source().all;
    if (points.length === 0) {
      this.deps.notify('Nothing measured yet.');
      return;
    }
    const peer = this.deps.peer();
    const series = this.source();
    const meta = {
      // Both taken from the series being exported rather than from the manual
      // session: the graph may be showing a staged run, whose legs the monitor
      // never ran — which wrote every row with two empty columns.
      startedAt: series.startedOn,
      directions: { down: hasData(points, 'down'), up: hasData(points, 'up') },
      server: peer?.name ?? 'this server',
    };
    downloadCsv(toCsv(points, meta), exportFilename(meta));
    this.deps.announce(`Exported ${points.length} samples as CSV.`);
  }

  private updateExportButton(): void {
    const empty = this.source().all.length === 0;
    this.exportButton.disabled = empty;
    // Nothing to clear, and nothing may be cleared out from under a session.
    this.clearButton.disabled = empty || this.running;
  }

  // ------------------------------------------------------------------- view --

  private applyUpdate(update: MonitorUpdate): void {
    this.deps.onReadings(update.downMbps, update.upMbps);
    // Kept for the frame loop, which draws between samples.
    this.live = {
      down: update.directions.down ? update.downMbps : 0,
      up: update.directions.up ? update.upMbps : 0,
    };
    // He runs at whatever the link is carrying, both directions together:
    // the treadmill is about effort, not about which way the bytes are going.
    this.treadmill.setRate(update.downMbps + update.upMbps);
    this.setRate('down', update.downMbps);
    this.setRate('up', update.upMbps);
    // What the link is carrying, which on a shared line is the figure to hold
    // against a rate rather than either direction on its own.
    this.setRate('both', update.downMbps + update.upMbps);
    this.setReadout('moved', formatBytes(update.downBytes + update.upBytes), '');
  }

  private draw(series: TimeSeries): void {
    const committed = series.all;
    const live = this.running || this.blocked !== null;

    const frameNow = performance.now();
    const dt = this.lastDraw === 0 ? 16 : frameNow - this.lastDraw;
    this.lastDraw = frameNow;

    // The newest reading has not been sampled yet, so it is drawn as a
    // provisional point at 'now', ahead of the last committed sample. Without
    // it the line only grows when a sample lands — once a second — which is
    // the staircase this exists to remove. The point is drawn for whichever
    // test is running, not only this panel's own session.
    let nowMs = live ? this.elapsedFor(series) : this.monitor.elapsedMs;
    const points = committed;
    let lead: { t: number; down: number; up: number } | null = null;

    // The provisional point exists to keep the *live edge* moving smoothly.
    // Panned away to look at history there is no live edge on screen, and
    // appending a point beyond the window leaves the curve's last control
    // point drifting, so the picture never quite settles.
    if (live && this.viewport.isFocused) {
      // A direction carrying nothing is *at* zero, not on its way there. The
      // edge eases, so easing it down from the last reading drew the pen above
      // a line already on the floor: a dip and a climb back over a second or
      // so, describing a fall the link never made. Only a direction still
      // moving bytes is worth easing.
      if (this.live.down > 0) this.edge.down.setTarget(this.live.down);
      else this.edge.down.reset();
      if (this.live.up > 0) this.edge.up.setTarget(this.live.up);
      else this.edge.up.reset();
      // Never behind the last committed sample. The clock and the samples come
      // from different places, so around a stop the provisional point can land
      // *before* the final sample — which gives the spline a segment that runs
      // backwards in time and makes it loop over itself.
      const lastT = committed[committed.length - 1]?.t ?? 0;
      if (nowMs > lastT) {
        lead = {
          t: nowMs,
          down: this.edge.down.advance(dt),
          up: this.edge.up.advance(dt),
        };
      } else {
        nowMs = lastT;
      }
    } else {
      this.edge.down.reset();
      this.edge.up.reset();
      nowMs = committed[committed.length - 1]?.t ?? 0;
    }

    const drawn = lead ? [...points, lead] : points;

    this.emptyNote.hidden = drawn.length > 0;

    const newest = Math.max(nowMs, drawn[drawn.length - 1]?.t ?? 0);
    const span = this.viewport.window(newest);
    const view: GraphView = {
      width: this.size.width,
      height: this.size.height,
      fromMs: span.fromMs,
      toMs: span.toMs,
    };

    // Both lines are always drawn. A direction that is switched off is
    // carrying nothing, so its line runs along the floor — which is a reading,
    // and readable as one. Blanking the path instead made the line vanish, so
    // a download-only session looked as though the upload trace was broken
    // rather than flat.
    const shown = this.shown();
    // Only what is on screen: see `visible`.
    const shownPoints = visible(drawn, view);
    // Drawn for whatever has measured something *or* is selected now. The
    // first half keeps history: in auto mode the switches follow the run's
    // current phase, so keying the trace off them alone wiped the download
    // the instant the run moved on. The second half keeps a selected but
    // silent direction visible as a line along the floor — which is a
    // reading, and the difference between "carrying nothing" and "not being
    // measured" is exactly what the graph is there to show.
    const drawDown = hasData(shownPoints, 'down') || shown.down;
    const drawUp = hasData(shownPoints, 'up') || shown.up;
    this.downLine.setAttribute('d', drawDown ? linePath(shownPoints, 'down', view) : '');
    this.upLine.setAttribute('d', drawUp ? linePath(shownPoints, 'up', view) : '');
    // Two translucent fills stacked on a log axis read as a third colour and
    // hide the grid behind them, so a two-way session is drawn as two lines
    // and nothing else. One direction keeps its tint, where there is nothing
    // to confuse it with.
    const tint = !(drawDown && drawUp);
    this.downArea.setAttribute('d', tint && drawDown ? areaPath(shownPoints, 'down', view) : '');
    this.upArea.setAttribute('d', tint && drawUp ? areaPath(shownPoints, 'up', view) : '');

    const stats = series.stats;
    this.setRate('peak-down', stats.peakDown);
    this.setRate('peak-up', stats.peakUp);


    this.paintAxis(view, newest);
    this.paintMarkers(view, lead, shown, live);
    this.paintGrid(view);
    this.updateExportButton();
  }

  /**
   * Matches the viewBox to the element's pixel size. Returns whether it
   * changed, so a resize that changed nothing does not force a redraw.
   */
  private measure(): boolean {
    const rect = this.svg.getBoundingClientRect();
    const width = Math.round(rect.width) || VIEW.width;
    const height = Math.round(rect.height) || VIEW.height;
    if (width === this.size.width && height === this.size.height) return false;
    this.size = { width, height };
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return true;
  }

  /**
   * Rules the decade lines.
   *
   * The comment this replaces said "redrawn once a second", which stopped
   * being true when drawing moved to a frame loop: rebuilding ten elements
   * sixty times a second held the redraw down to about fifteen frames, and a
   * line that only advances every fourth frame is exactly the staircase this
   * was all meant to remove. The grid depends only on the plot's size, so it
   * is rebuilt when that changes and left alone otherwise.
   */
  private paintGrid(view: GraphView): void {
    const key = `${view.width}x${view.height}`;
    if (key === this.gridKey) return;
    this.gridKey = key;

    this.grid.replaceChildren(
      ...gridLines(view).flatMap((line) => {
        const rule = document.createElementNS(SVG_NS, 'line');
        rule.setAttribute('class', 'monitor__grid-line');
        rule.setAttribute('x1', '0');
        rule.setAttribute('x2', String(view.width));
        rule.setAttribute('y1', line.y.toFixed(2));
        rule.setAttribute('y2', line.y.toFixed(2));

        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('class', 'monitor__grid-label');
        label.setAttribute('x', '6');
        label.setAttribute('y', (line.y - 4).toFixed(2));
        // The unit on every line, rather than once in a corner: a reader
        // glancing at a single gridline should not have to hunt for what the
        // number counts.
        label.textContent = `${line.label} ${UNIT}`;
        return [rule, label];
      }),
    );
  }

  /**
   * Labels the time axis and says what the window is showing.
   *
   * Rebuilt only when the labels would differ, since this runs inside the
   * frame loop and building DOM per frame is what held the redraw to fifteen
   * frames a second once before.
   */
  private paintAxis(view: GraphView, newestMs: number): void {
    const ticks = timeTicks(view, newestMs);
    const key = ticks.map((tick) => `${tick.label}@${tick.x.toFixed(0)}`).join('|');
    if (key !== this.axisKey) {
      this.axisKey = key;
      this.axis.replaceChildren(
        ...ticks.flatMap((tick) => {
          const rule = document.createElementNS(SVG_NS, 'line');
          rule.setAttribute('class', 'monitor__axis-rule');
          rule.setAttribute('x1', tick.x.toFixed(2));
          rule.setAttribute('x2', tick.x.toFixed(2));
          rule.setAttribute('y1', '0');
          // Stops at the gutter, so the rules do not run through the labels.
          rule.setAttribute('y2', String(view.height - AXIS_GUTTER));

          const label = document.createElementNS(SVG_NS, 'text');
          label.setAttribute('class', 'monitor__axis-label');
          label.setAttribute('y', (view.height - 5).toFixed(2));
          // Centred labels at either end hang half outside the viewBox and
          // are clipped, which turned "-30s" into "0s" at the left edge.
          // The end ones tuck inside instead.
          const margin = 28;
          if (tick.x < margin) {
            label.setAttribute('x', '4');
            label.setAttribute('text-anchor', 'start');
          } else if (tick.x > view.width - margin) {
            label.setAttribute('x', (view.width - 4).toFixed(2));
            label.setAttribute('text-anchor', 'end');
          } else {
            label.setAttribute('x', tick.x.toFixed(2));
            label.setAttribute('text-anchor', 'middle');
          }
          label.textContent = tick.label;
          return [rule, label];
        }),
      );
    }

    const span = view.toMs - view.fromMs;
    const following = this.viewport.isFocused;
    // How long the session has run, beside how much of it is on screen. It
    // was a readout of its own; it belongs with the window it qualifies, and
    // that is one fewer tile in a grid that had too many.
    const elapsed = this.source().last?.t ?? 0;
    this.spanLabel.textContent =
      span > 0 ? `${formatElapsed(elapsed)} · ${formatSpan(span)} window` : '';
    this.focusButton.dataset.on = String(following);
    this.focusButton.setAttribute('aria-pressed', String(following));
  }

  /**
   * Rules a line across the plot at each live reading, labelled at the right.
   *
   * The graph says what the link has been doing; this says what it is doing
   * now, on the same scale, so the two do not have to be reconciled by eye.
   * Only drawn while something is running — a rule across a finished session
   * would be pointing at a reading that no longer exists.
   */
  private paintMarkers(
    view: GraphView,
    lead: { down: number; up: number } | null,
    shown: Directions,
    live: boolean,
  ): void {
    if (!live || !lead) {
      if (this.marker.childNodes.length > 0) this.marker.replaceChildren();
      return;
    }

    const rows: [key: 'down' | 'up', value: number][] = [];
    if (shown.down) rows.push(['down', lead.down]);
    if (shown.up) rows.push(['up', lead.up]);

    this.marker.replaceChildren(
      ...rows.flatMap(([key, value]) => {
        const y = yFor(value, view);
        const rule = document.createElementNS(SVG_NS, 'line');
        rule.setAttribute('class', `monitor__marker monitor__marker--${key}`);
        rule.setAttribute('x1', '0');
        rule.setAttribute('x2', String(view.width));
        rule.setAttribute('y1', y.toFixed(2));
        rule.setAttribute('y2', y.toFixed(2));

        const rate = formatRate(value);
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('class', `monitor__marker-label monitor__marker-label--${key}`);
        text.setAttribute('x', (view.width - 6).toFixed(2));
        // Nudged off the rule so the text does not sit on the line it labels,
        // and kept inside the plot at the very top and bottom.
        const offset = y < 14 ? 12 : -5;
        text.setAttribute('y', (y + offset).toFixed(2));
        text.setAttribute('text-anchor', 'end');
        text.textContent = `${rate.value} ${rate.unit}`;
        return [rule, text];
      }),
    );
  }

  private setRate(key: string, mbps: number): void {
    const rate = formatRate(mbps);
    this.setReadout(key, rate.value, rate.unit);
  }

  private setReadout(key: string, value: string, unit: string): void {
    const readout = this.readouts.get(key);
    if (!readout) return;
    if (readout.value.textContent !== value) readout.value.textContent = value;
    if (readout.unit.textContent !== unit) readout.unit.textContent = unit;
  }

  // ------------------------------------------------------------- directions --

  /**
   * The two direction switches, which double as the graph's legend.
   *
   * Drawn as actual switches — a track and a travelling thumb — rather than as
   * chips that merely change colour. A chip's selected state has to be learned
   * by comparing it against its neighbour; a switch reads as on or off on its
   * own, which matters here because either, neither-but-one, or both may be
   * on, and because they can now be thrown mid-session.
   *
   * Each carries the colour of the line it turns on, so it is the legend as
   * well as the control and there is nothing to look up.
   */
  private buildToggles(): HTMLElement {
    const group = el('div', { class: 'monitor__directions' });
    const specs: [key: DirectionKey, label: string, hint: string][] = [
      ['down', 'Download', 'Pull data from the server'],
      ['up', 'Upload', 'Push data to the server'],
    ];
    for (const [key, label, hint] of specs) {
      const button = el('button', {
        class: `monitor__direction monitor__direction--${key}`,
        type: 'button',
        role: 'switch',
        'aria-checked': 'false',
        title: hint,
      }) as HTMLButtonElement;
      button.append(
        el('span', { class: 'monitor__switch' }, el('span', { class: 'monitor__thumb' })),
        el(
          'span',
          { class: 'monitor__direction-text' },
          el('span', { class: 'monitor__direction-label', html: icon(key === 'down' ? 'download' : 'upload') }, label),
          el('span', { class: 'monitor__direction-state' }, 'Off'),
        ),
      );
      button.addEventListener('click', () => this.flip(key));
      this.toggles.set(key, button);
      group.append(button);
    }
    return group;
  }

  /**
   * Turns one direction on or off.
   *
   * Turning off the last one would leave a test that measures nothing, so it
   * turns the other one on instead of refusing. Refusing silently reads as a
   * broken button; swapping is what someone pressing it almost certainly
   * meant.
   */
  /**
   * Turns a direction on or off from outside, for the keyboard shortcut.
   *
   * Refused while the speed test owns the link, exactly as the switches are:
   * a shortcut that does something the visible control refuses would be worse
   * than no shortcut.
   */
  toggleDirection(key: DirectionKey): boolean {
    if (this.blocked !== null || this.mode === 'auto') return false;
    this.flip(key);
    return true;
  }

  /** Starts or stops a session, for the keyboard shortcut. */
  toggleRun(): boolean {
    if (this.blocked !== null) return false;
    this.toggle();
    return true;
  }

  private flip(key: DirectionKey): void {
    // Each switch means only itself. Turning the other one on to avoid an
    // empty pair made the control lie about what it does — pressing
    // "download off" silently turned upload on — and there is a perfectly
    // good reading of both being off: measure nothing for a while and watch
    // the link settle. A session with neither is simply idle.
    this.directions = { ...this.directions, [key]: !this.directions[key] };
    this.paintDirections();
    // The primary button names what it will start, which changes with the
    // selection — "Watch idle link" once nothing is on — so it is repainted
    // here and not only when a session starts or stops.
    this.setRunning(this.running);
    // Mid-session this starts or stops that direction without disturbing the
    // other, the clock or the history.
    if (this.running) this.monitor.setDirections(this.directions);
    this.refresh();
  }

  private paintDirections(): void {
    const shown = this.shown();
    const locked = this.blocked !== null || this.mode === 'auto';
    for (const [key, button] of this.toggles) {
      const on = shown[key];
      button.dataset.on = String(on);
      button.setAttribute('aria-checked', String(on));
      // Not the visitor's to change while the speed test owns the link.
      button.disabled = locked;
      button.title = locked
        ? 'The speed test chooses its own directions; this shows what it is doing.'
        : key === 'down'
          ? 'Pull data from the server (D)'
          : 'Push data to the server (U)';
      const state = button.querySelector('.monitor__direction-state');
      // Said in words as well as in position, so the state does not depend on
      // seeing where a small thumb sits.
      if (state) {
        // "Set by the test" says why it cannot be changed, which "Measuring"
        // did not: a switch that is merely greyed looks broken rather than
        // borrowed.
        state.textContent = locked
          ? on
            ? 'Measuring'
            : 'Set by the test'
          : on
            ? this.running
              ? 'Measuring'
              : 'On'
            : 'Off';
      }
    }
    this.root.dataset.down = String(shown.down);
    this.root.dataset.up = String(shown.up);
    // Marks the figures that belong to a manual session rather than to
    // whatever is currently on the graph.
    this.root.dataset.foreign = String(this.blocked !== null);
    // Saying it once, where it applies, beats a footnote nobody reads.
    this.warning.hidden = !isBidirectional(shown);
  }

  // ------------------------------------------------------------------ build --

  private buildChart(): {
    controls: HTMLElement;
    plot: HTMLElement;
    svg: SVGSVGElement;
    grid: SVGGElement;
    axis: SVGGElement;
    marker: SVGGElement;
    downArea: SVGPathElement;
    downLine: SVGPathElement;
    upArea: SVGPathElement;
    upLine: SVGPathElement;
    span: HTMLElement;
    empty: HTMLElement;
    warning: HTMLElement;
  } {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'monitor__chart');
    svg.setAttribute('viewBox', `0 0 ${VIEW.width} ${VIEW.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute(
      'aria-label',
      'Throughput over time. Drag or use the arrow keys to move through the ' +
        'session, plus and minus to zoom, F to follow the newest reading.',
    );

    const grid = document.createElementNS(SVG_NS, 'g');
    const axis = document.createElementNS(SVG_NS, 'g');
    const make = (cls: string): SVGPathElement => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', cls);
      path.setAttribute('d', '');
      return path;
    };
    // A rule at the current reading, so the live figure can be read off the
    // scale itself rather than only from a number somewhere else.
    const marker = document.createElementNS(SVG_NS, 'g');
    marker.setAttribute('class', 'monitor__markers');

    const downArea = make('monitor__area monitor__area--down');
    const downLine = make('monitor__line monitor__line--down');
    const upArea = make('monitor__area monitor__area--up');
    const upLine = make('monitor__line monitor__line--up');
    svg.append(grid, downArea, upArea, downLine, upLine, marker, axis);

    const empty = el(
      'p',
      { class: 'monitor__empty' },
      'Nothing measured yet. Choose a direction and start.',
    );
    const span = el('span', { class: 'monitor__span' });
    const warning = el(
      'p',
      { class: 'monitor__warning', html: icon('info') },
      'Both directions share the link, so these are not two independent ' +
        'measurements — saturating the uplink slows the downlink too.',
    );
    warning.hidden = true;

    const controls = el(
      'div',
      { class: 'monitor__controls' },
      this.buildToggles(),
      this.buildViewControls(),
      span,
    );
    const plot = el('div', { class: 'monitor__plot' }, svg, empty);
    return { controls, plot, svg, grid, axis, marker, downArea, downLine, upArea, upLine, span, empty, warning };
  }

  /**
   * Nookies, on a treadmill above the graph.
   *
   * He is the mascot, so he belongs on both screens; what he is doing differs
   * because the tests differ. The lift is a journey with an end, which a
   * continuous test does not have, so here he simply runs — at the pace the
   * link is working — until you stop him.
   */
  private buildRider(): Treadmill {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'monitor__rider');
    svg.setAttribute('viewBox', '-52 -34 104 82');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = jogMarkup();
    this.rider = svg;
    return new Treadmill(svg.querySelector('.jog') as SVGGElement);
  }

  /**
   * Zoom, and the focus switch.
   *
   * Focus is deliberately a separate control from zoom: following the live
   * edge and how much time is on screen are different questions, and a single
   * "auto" button that did both would mean neither could be chosen alone.
   */
  private buildViewControls(): HTMLElement {
    const zoomOut = el('button', {
      class: 'icon-button monitor__zoom',
      type: 'button',
      title: 'Show more time',
      'aria-label': 'Show more time',
      html: ZOOM_OUT_ICON,
    }) as HTMLButtonElement;
    zoomOut.addEventListener('click', () => this.zoom(1.6));

    const zoomIn = el('button', {
      class: 'icon-button monitor__zoom',
      type: 'button',
      title: 'Show less time',
      'aria-label': 'Show less time',
      html: ZOOM_IN_ICON,
    }) as HTMLButtonElement;
    zoomIn.addEventListener('click', () => this.zoom(1 / 1.6));

    this.focusButton = el('button', {
      class: 'monitor__focus',
      type: 'button',
      role: 'switch',
      'aria-checked': 'true',
      'data-on': 'true',
      title: 'Keep the window on the newest reading',
    }) as HTMLButtonElement;
    this.focusButton.append(
      el('span', { class: 'monitor__switch' }, el('span', { class: 'monitor__thumb' })),
      document.createTextNode('Follow'),
    );
    this.focusButton.addEventListener('click', () => {
      this.viewport.setFocus(!this.viewport.isFocused);
      this.refresh();
    });

    return el('div', { class: 'monitor__view' }, zoomOut, zoomIn, this.focusButton);
  }

  private zoom(factor: number, at = 0.5): void {
    this.viewport.zoom(factor, this.newestMs(), at);
    this.refresh();
  }

  /** The far end of the timeline, which zoom and pan are measured against. */
  private newestMs(): number {
    const series = this.source();
    return Math.max(this.elapsedFor(series), series.last?.t ?? 0);
  }

  /**
   * Drag to pan, wheel to zoom.
   *
   * Dragging stops the window following the live edge — a graph that snapped
   * back to now the moment you let go would make looking at anything earlier
   * impossible.
   */
  private bindPanning(svg: SVGSVGElement): void {
    let pointer: number | null = null;
    let lastX = 0;

    svg.addEventListener('pointerdown', (event) => {
      pointer = event.pointerId;
      lastX = event.clientX;
      svg.setPointerCapture(pointer);
      svg.dataset.dragging = 'true';
    });

    svg.addEventListener('pointermove', (event) => {
      if (pointer !== event.pointerId) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return;
      const span = this.viewport.window(this.newestMs());
      const perPixel = (span.toMs - span.fromMs) / rect.width;
      const dx = event.clientX - lastX;
      if (dx === 0) return;
      lastX = event.clientX;
      // Dragging right moves the window back in time, as though the paper
      // under the pen were being pulled along.
      this.viewport.pan(-dx * perPixel, this.newestMs());
      this.refresh();
    });

    const release = (event: PointerEvent): void => {
      if (pointer !== event.pointerId) return;
      svg.releasePointerCapture(pointer);
      pointer = null;
      delete svg.dataset.dragging;
    };
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);

    /**
     * Wheel conventions, chosen to match what the rest of the desktop does:
     *
     *  - **Ctrl/Cmd + wheel** zooms, around the pointer. This is what every
     *    map and every browser does, so it is the one gesture nobody has to
     *    be taught.
     *  - **Shift + wheel** scrolls sideways through time, the usual way to
     *    scroll a wide thing.
     *  - A trackpad's own horizontal swipe (`deltaX`) pans too.
     *  - A plain vertical wheel is left alone, so the page still scrolls. A
     *    chart that swallows the scroll wheel traps the reader on it.
     */
    svg.addEventListener(
      'wheel',
      (event) => {
        const rect = svg.getBoundingClientRect();

        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          const at = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
          this.zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15, at);
          return;
        }

        const sideways = event.shiftKey ? event.deltaY : event.deltaX;
        if (sideways === 0 || rect.width <= 0) return;
        event.preventDefault();
        const window = this.viewport.window(this.newestMs());
        const perPixel = (window.toMs - window.fromMs) / rect.width;
        this.viewport.pan(sideways * perPixel, this.newestMs());
        this.refresh();
      },
      { passive: false },
    );

    /**
     * The same moves from the keyboard, so the graph is not mouse-only.
     */
    svg.addEventListener('keydown', (event) => {
      const window = this.viewport.window(this.newestMs());
      const span = window.toMs - window.fromMs;
      const stride = span * (event.shiftKey ? 0.5 : 0.1);
      switch (event.key) {
        case 'ArrowLeft':
          this.viewport.pan(-stride, this.newestMs());
          break;
        case 'ArrowRight':
          this.viewport.pan(stride, this.newestMs());
          break;
        case '+':
        case '=':
          this.viewport.zoom(1 / 1.6, this.newestMs());
          break;
        case '-':
        case '_':
          this.viewport.zoom(1.6, this.newestMs());
          break;
        case 'f':
        case 'F':
          this.viewport.setFocus(!this.viewport.isFocused);
          break;
        case '0':
          this.viewport.reset();
          break;
        default:
          return;
      }
      event.preventDefault();
      this.refresh();
    });
  }

  private buildReadouts(): HTMLElement {
    const grid = el('div', { class: 'monitor__readouts' });
    /*
     * Six figures, not eight.
     *
     * The averages are gone: the graph is the average, drawn, and a number
     * that only agrees with the picture beside it earns its place by being
     * read more precisely than the picture can be. Peaks stay, because a peak
     * is the one thing a scrolled-away graph cannot tell you.
     *
     * "Both" is the sum of the two directions, which is what the link is
     * actually carrying — the figure to compare against a line rate when
     * something is running in both directions at once.
     */
    const cells: [key: string, label: string][] = [
      ['down', 'Download'],
      ['up', 'Upload'],
      ['both', 'Both'],
      ['peak-down', 'Peak down'],
      ['peak-up', 'Peak up'],
      ['moved', 'Transferred'],
    ];
    for (const [key, label] of cells) {
      const value = el('span', { class: 'monitor__value tnum' }, '—');
      const unit = el('span', { class: 'monitor__unit' }, '');
      const cell = el(
        'div',
        { class: 'monitor__readout', 'data-key': key },
        el('span', { class: 'monitor__label' }, label),
        el('span', { class: 'monitor__figure' }, value, unit),
      );
      this.readouts.set(key, { root: cell, value, unit });
      grid.append(cell);
    }
    return grid;
  }
}
