import { Component } from '../../core';
import { el, hydrateRipples } from '../primitives/dom';
import { icon } from '../primitives/icons';

export interface GraphModalHandlers {
  readonly onClose: () => void;
}

/**
 * The graph, shown over the page rather than instead of it.
 *
 * It was a view of the main page once, which meant everything else had to get
 * out of its way: the stat tiles and the history were removed while it showed,
 * the column layout was rearranged around it, and the page grew tall enough to
 * need scrolling to reach controls that had not moved. A graph is something you
 * open, read and dismiss, so a dialog is the honest shape for it — the page
 * underneath is left exactly as it was, and closing costs nothing.
 *
 * It holds no content of its own. The monitor panel is moved into it and moved
 * back out again, because that panel *is* the session: rebuilding it here would
 * throw away the run it is drawing.
 */
export class GraphModal extends Component<HTMLElement> {
  private readonly body = el('div', { class: 'graph-modal__body' });
  private open = false;

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.open || event.key !== 'Escape') return;
    event.preventDefault();
    this.handlers.onClose();
  };

  constructor(private readonly handlers: GraphModalHandlers) {
    super(el('div', { class: 'graph-modal', hidden: true }));

    const close = el('button', {
      class: 'icon-button graph-modal__close',
      type: 'button',
      title: 'Close the graph',
      'aria-label': 'Close the graph',
      html: icon('close'),
    }) as HTMLButtonElement;
    close.addEventListener('click', () => this.handlers.onClose());

    const panel = el(
      'div',
      {
        class: 'graph-modal__panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Throughput over time',
      },
      close,
      this.body,
    );

    this.root.append(panel);
    // A click on the backdrop dismisses; one inside the dialog must not.
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.handlers.onClose();
    });
    document.addEventListener('keydown', this.onKey, true);
    hydrateRipples(this.root);
  }

  override destroy(): void {
    document.removeEventListener('keydown', this.onKey, true);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Puts `content` on screen. The element is moved, never copied. */
  show(content: HTMLElement): void {
    this.body.replaceChildren(content);
    this.root.hidden = false;
    this.open = true;
    // The page behind must not scroll under an overlay that covers it.
    document.body.dataset.modal = 'open';
  }

  /**
   * Hides the dialog and hands its content back.
   *
   * The caller is responsible for putting it somewhere, since the panel has a
   * home to return to and leaving it detached would stop it being redrawn.
   */
  hide(): HTMLElement | null {
    const content = this.body.firstElementChild as HTMLElement | null;
    this.body.replaceChildren();
    this.root.hidden = true;
    this.open = false;
    delete document.body.dataset.modal;
    return content;
  }
}
