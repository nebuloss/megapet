import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';

import { ApiClient } from './api';
import { Preferences } from './core';
import { ThemeController } from './theme';
import { App } from './ui/app';
import { el } from './ui/primitives/dom';

/**
 * Bootstrap.
 *
 * The dependency graph is assembled once, here, and passed down by
 * construction — nothing in the app reaches for a global. The order matters:
 * the server's config supplies the default seed colour, so the theme is built
 * after the config arrives and before anything renders.
 */
async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app mount point');

  const preferences = new Preferences('megapet');
  const api = new ApiClient();

  try {
    const config = await api.config();
    const theme = new ThemeController(preferences, config.seed_color);
    document.title = config.title;
    new App(config, api, theme, preferences).mount(root);
  } catch (error) {
    // Without the server config there is nothing meaningful to render, so say
    // so plainly rather than showing a dead UI.
    new ThemeController(preferences);
    root.replaceChildren(
      el(
        'main',
        {},
        el(
          'section',
          { class: 'card' },
          el('h1', { class: 'section__title' }, 'Cannot reach the server'),
          el(
            'p',
            { class: 'result-note' },
            error instanceof Error ? error.message : String(error),
          ),
        ),
      ),
    );
  }
}

void boot();
