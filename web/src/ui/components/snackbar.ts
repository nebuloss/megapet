import { el } from '../primitives/dom';

export interface SnackbarAction {
  readonly label: string;
  readonly onClick: () => void;
}

/**
 * Transient messages at the bottom of the screen.
 *
 * One instance owns the single visible bar, so showing a new message replaces
 * the old one instead of stacking. That is the Material behaviour, and it also
 * means there is exactly one timer to cancel.
 */
export class Snackbar {
  private current: HTMLElement | null = null;
  private timer: number | undefined;

  constructor(private readonly host: HTMLElement = document.body) {}

  show(message: string, action?: SnackbarAction): void {
    this.dismiss();

    const bar = el('div', { class: 'snackbar', role: 'status', 'aria-live': 'polite' },
      el('span', {}, message),
    );
    if (action) {
      const button = el('button', { class: 'btn btn--text', type: 'button' }, action.label);
      button.addEventListener('click', () => {
        action.onClick();
        this.dismiss();
      });
      bar.append(button);
    }

    this.host.append(bar);
    this.current = bar;
    // An actionable message gets longer, since it asks the reader to decide.
    this.timer = window.setTimeout(() => this.dismiss(), action ? 8000 : 4500);
  }

  dismiss(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = undefined;
    const bar = this.current;
    this.current = null;
    if (!bar) return;

    bar.dataset.leaving = 'true';
    bar.addEventListener('animationend', () => bar.remove(), { once: true });
    // Guarantees removal even where the animation is suppressed.
    window.setTimeout(() => bar.remove(), 400);
  }

  destroy(): void {
    this.dismiss();
  }
}
