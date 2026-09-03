import { el } from './dom';

let current: HTMLElement | null = null;
let timer: number | undefined;

/** Shows a transient message at the bottom of the screen. */
export function toast(message: string, action?: { label: string; onClick: () => void }): void {
  dismiss();

  const bar = el('div', { class: 'snackbar', role: 'status', 'aria-live': 'polite' },
    el('span', {}, message),
  );
  if (action) {
    const button = el('button', { class: 'btn btn--text', type: 'button' }, action.label);
    button.addEventListener('click', () => {
      action.onClick();
      dismiss();
    });
    bar.append(button);
  }

  document.body.append(bar);
  current = bar;
  timer = window.setTimeout(dismiss, action ? 8000 : 4500);
}

export function dismiss(): void {
  if (timer) window.clearTimeout(timer);
  const bar = current;
  current = null;
  if (!bar) return;
  bar.dataset.leaving = 'true';
  bar.addEventListener('animationend', () => bar.remove(), { once: true });
  // Guarantee removal even where the animation is suppressed.
  window.setTimeout(() => bar.remove(), 400);
}
