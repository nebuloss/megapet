/**
 * Keyboard shortcuts for the things you do repeatedly.
 *
 * Deliberately unmodified single keys. This is a page with no text entry
 * outside a dialog, so the plain letters are free, and a shortcut you have to
 * reach for with two hands is one you will not use while watching a graph.
 * They are suppressed while typing and while a modifier is held, so browser
 * and assistive-technology bindings are never shadowed.
 */
export interface ShortcutBindings {
  /** Opens or closes the graph. */
  readonly onGraph: () => void;
  /** Starts or stops whichever mode is selected. */
  readonly onToggleRun: () => void;
  /** Turns the download direction on or off. */
  readonly onToggleDownload: () => void;
  readonly onToggleUpload: () => void;
}

/** Everything a visitor can press, for the help the UI shows. */
export const SHORTCUTS: readonly { keys: string; does: string }[] = [
  { keys: 'G', does: 'Show or hide the graph' },
  { keys: 'Space', does: 'Start or stop the test' },
  { keys: 'D', does: 'Download on or off' },
  { keys: 'U', does: 'Upload on or off' },
];

/**
 * Whether a key press belongs to whatever the visitor is typing into.
 *
 * Without this, pressing "d" in the note field would toggle a direction
 * instead of typing a letter — the classic way single-key shortcuts become a
 * bug rather than a convenience.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Binds the shortcuts to the document. Returns a function that unbinds them.
 */
export function bindShortcuts(bindings: ShortcutBindings): () => void {
  const onKey = (event: KeyboardEvent): void => {
    // A modifier means the press belongs to the browser or the system.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTyping(event.target)) return;
    // Repeat would fire dozens of times from one held key.
    if (event.repeat) return;

    switch (event.key) {
      case 'g':
      case 'G':
        bindings.onGraph();
        break;
      case 'd':
      case 'D':
        bindings.onToggleDownload();
        break;
      case 'u':
      case 'U':
        bindings.onToggleUpload();
        break;
      case ' ':
        // Space activates whatever is focused, so it is only a shortcut when
        // nothing in particular is: otherwise it would press the button under
        // the cursor *and* start a run.
        if (document.activeElement && document.activeElement !== document.body) return;
        bindings.onToggleRun();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
