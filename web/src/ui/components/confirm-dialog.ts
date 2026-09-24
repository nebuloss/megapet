import { el, hydrateRipples } from '../primitives/dom';

export interface ConfirmOptions {
  readonly title: string;
  readonly body: string;
  /** Label for the button that goes ahead. */
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /** Styles the confirming button as the destructive choice. */
  readonly destructive?: boolean;
}

/**
 * A modal question, resolved by the visitor.
 *
 * Deliberately not `window.confirm`: that blocks the main thread, which on
 * this page stops the very measurement the question is about — the graph
 * freezes and the running test keeps loading the link behind a dialog that
 * has stopped the clock used to measure it.
 *
 * Cancel is the default action, since this exists to guard against losing
 * work: Escape, a click on the scrim and the initial focus all take the
 * cautious branch.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: boolean): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      previous?.focus?.();
      resolve(answer);
    };

    const previous = document.activeElement as HTMLElement | null;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
        return;
      }
      // A modal that lets focus wander behind it is a modal in name only.
      if (event.key !== 'Tab') return;
      const focusable = [cancel, go];
      const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
      if (index === -1) return;
      event.preventDefault();
      const next = event.shiftKey ? index - 1 : index + 1;
      focusable[(next + focusable.length) % focusable.length]?.focus();
    };

    const cancel = el('button', {
      class: 'btn btn--text',
      type: 'button',
    }) as HTMLButtonElement;
    cancel.textContent = options.cancelLabel ?? 'Cancel';
    cancel.addEventListener('click', () => finish(false));

    const go = el('button', {
      class: `btn ${options.destructive ? 'btn--danger' : 'btn--tonal'}`,
      type: 'button',
    }) as HTMLButtonElement;
    go.textContent = options.confirmLabel;
    go.addEventListener('click', () => finish(true));

    const dialog = el(
      'div',
      {
        class: 'dialog',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dialog-title',
        'aria-describedby': 'dialog-body',
      },
      el('h2', { class: 'dialog__title', id: 'dialog-title' }, options.title),
      el('p', { class: 'dialog__body', id: 'dialog-body' }, options.body),
      el('div', { class: 'dialog__actions' }, cancel, go),
    );

    const scrim = el('div', { class: 'scrim' }, dialog);
    scrim.addEventListener('click', (event) => {
      if (event.target === scrim) finish(false);
    });

    document.body.append(scrim);
    hydrateRipples(scrim);
    document.addEventListener('keydown', onKey, true);
    cancel.focus();
  });
}
