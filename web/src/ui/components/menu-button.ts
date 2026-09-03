import { Component } from '../../core';
import { el, hydrateRipples } from '../primitives/dom';
import { icon, type IconName } from '../primitives/icons';

/** Builds the menu's contents. `close` dismisses the menu from an item. */
export type MenuContent = (close: () => void) => HTMLElement[];

/**
 * An icon button that opens a popup menu.
 *
 * The contents are built on each open rather than once, so an item's checked
 * state always reflects the live value instead of whatever it was when the
 * button was constructed. Closes on Escape or a pointer press elsewhere, and
 * removes those global listeners as soon as it does.
 */
export class MenuButton extends Component<HTMLDivElement> {
  private readonly button: HTMLButtonElement;
  private menu: HTMLElement | null = null;

  private readonly onOutsidePress = (event: PointerEvent): void => {
    if (!this.root.contains(event.target as Node)) this.close();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    this.close();
    this.button.focus();
  };

  constructor(
    iconName: IconName,
    label: string,
    private readonly content: MenuContent,
  ) {
    super(el('div', { class: 'menu-anchor' }));

    this.button = el('button', {
      class: 'icon-button',
      type: 'button',
      title: label,
      'aria-label': label,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      html: icon(iconName),
    }) as HTMLButtonElement;
    this.button.addEventListener('click', () => this.toggle());
    this.root.append(this.button);
  }

  toggle(): void {
    if (this.menu) this.close();
    else this.open();
  }

  open(): void {
    if (this.menu) return;
    this.menu = el('div', { class: 'menu', role: 'menu' }, ...this.content(() => this.close()));
    this.root.append(this.menu);
    hydrateRipples(this.menu);
    this.button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this.onOutsidePress, true);
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  close(): void {
    this.menu?.remove();
    this.menu = null;
    this.button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.onOutsidePress, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
  }

  override destroy(): void {
    this.close();
  }
}

/** A radio-style menu row. */
export function menuItem(options: {
  label: string;
  sub?: string;
  iconHtml: string;
  checked: boolean;
  onSelect: () => void;
}): HTMLElement {
  const item = el(
    'button',
    {
      class: 'menu__item',
      type: 'button',
      role: 'menuitemradio',
      'aria-checked': String(options.checked),
    },
    el('span', { html: options.iconHtml }),
    el(
      'span',
      {},
      el('span', {}, options.label),
      options.sub ? el('span', { class: 'menu__item-sub' }, options.sub) : null,
    ),
  );
  item.addEventListener('click', options.onSelect);
  return item;
}

/** A non-interactive group heading inside a menu. */
export function menuLabel(text: string): HTMLElement {
  return el('div', { class: 'menu__label' }, text);
}
