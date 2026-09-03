import { el } from '../primitives/dom';
import { icon, type IconName } from '../primitives/icons';

/** A small labelled pill, used for the connection details under the hero. */
export function chip(iconName: IconName, text: string): HTMLElement {
  return el('span', { class: 'chip', title: text, html: icon(iconName) }, el('span', {}, text));
}
