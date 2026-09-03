import { Component } from '../../core';
import type { StoredResult } from '../../domain/types';
import type { Snackbar } from '../components';
import { el, hydrateRipples } from '../primitives/dom';
import { icon } from '../primitives/icons';

/**
 * The share row for a saved result: the permalink, a copy button and a link to
 * the SVG card.
 *
 * The server sends absolute URLs so they are correct behind a proxy; the
 * fallbacks here only matter if a caller constructs one from a bare result.
 */
export class SharePanel extends Component {
  constructor(result: StoredResult, snackbar: Snackbar) {
    super(el('div', { class: 'share-row' }));

    const url = result.url ?? `${window.location.origin}/r/${result.id}`;
    const cardUrl = result.card_url ?? `/api/results/${result.id}/card.svg`;

    const copy = el('button', { class: 'btn btn--tonal', type: 'button', html: icon('copy') });
    copy.append(document.createTextNode('Copy link'));
    copy.addEventListener('click', () => {
      void SharePanel.copy(url, snackbar);
    });

    const card = el('a', {
      class: 'btn btn--outlined',
      href: cardUrl,
      target: '_blank',
      rel: 'noopener',
      html: icon('image'),
    });
    card.append(document.createTextNode('Image card'));

    this.root.append(el('div', { class: 'share-link', title: url }, url), copy, card);
    hydrateRipples(this.root);
  }

  private static async copy(text: string, snackbar: Snackbar): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      snackbar.show('Link copied to the clipboard.');
    } catch {
      // Denied permission, or an insecure context. The link is on screen, so
      // say what to do rather than failing silently.
      snackbar.show('Could not copy — select the link and copy it manually.');
    }
  }
}
