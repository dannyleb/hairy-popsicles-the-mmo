export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function img(src, className) {
  const node = el('img', className);
  node.src = src;
  node.alt = '';
  node.draggable = false;
  return node;
}

const base = import.meta.env.BASE_URL;
export const spriteUrl = (id) => `${base}characters/small/${id}.webp`;
export const bigSpriteUrl = (id) => `${base}characters/${id}.webp`;
export const worldUrl = (name) => `${base}world/${name}.webp`;

// Small line icons for the HUD buttons, drawn in currentColor.
const ICONS = {
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  emote: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c2 2 5 2 7 0M9 9.5h.01M15 9.5h.01"/>',
  ranks: '<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 20h8"/>',
  album: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11"/>',
  shop: '<path d="M5 8h14l-1.2 12H6.2zM9 10V7a3 3 0 0 1 6 0v3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  send: '<path d="M4 12l16-8-6 16-2-6z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export function icon(name) {
  const wrap = el('span', 'icon');
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return wrap;
}

export function iconButton(className, iconName, label, onClick) {
  const node = button(className, null, onClick);
  node.append(icon(iconName));
  node.setAttribute('aria-label', label);
  return node;
}

export function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
