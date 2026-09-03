import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { fetchConfig } from './api';
import { initTheme } from './theme';
import { App } from './ui/app';
import { el } from './ui/dom';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app mount point');

  try {
    const config = await fetchConfig();
    initTheme(config.seed_color);
    document.title = config.title;
    new App(config).mount(root);
  } catch (err) {
    // Without the server config there is nothing meaningful to render, so say
    // so plainly rather than showing a dead UI.
    initTheme();
    root.replaceChildren(
      el(
        'main',
        {},
        el(
          'section',
          { class: 'card' },
          el('h1', { class: 'section__title' }, 'Cannot reach the speedtest server'),
          el('p', { class: 'result-note' }, err instanceof Error ? err.message : String(err)),
        ),
      ),
    );
  }
}

void boot();
