type Attrs = Record<string, string | number | boolean | undefined>;

/** Minimal element builder: attributes, then children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key.startsWith('data-') || key.startsWith('aria-')) {
      node.setAttribute(key, String(value));
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/** Attaches a Material state-layer ripple to a button-like element. */
export function attachRipple(target: HTMLElement): void {
  target.addEventListener('pointerdown', (event) => {
    if (target.hasAttribute('disabled')) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    target.append(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  });
}

/** Applies ripples to every button inside root that does not have one yet. */
export function hydrateRipples(root: ParentNode): void {
  for (const node of root.querySelectorAll<HTMLElement>('.btn, .icon-button, .list-row, .swatch')) {
    if (node.dataset.ripple === 'on') continue;
    node.dataset.ripple = 'on';
    attachRipple(node);
  }
}
