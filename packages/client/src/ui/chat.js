import { CHAT_MAX, EMOTES } from '@hptm/shared';
import { sfx } from '../audio/sfx.js';
import { button, el, iconButton } from './dom.js';

const VISIBLE_LINES = 4;
const LINE_FADE_MS = 12_000;
const HISTORY = 30;

// The chat log over the dock, the typing bar, and the emote picker.
export function createChat({ onSend, onEmote }) {
  const log = el('div', 'chat-log');
  const history = [];

  const bar = el('form', 'chat-bar');
  bar.hidden = true;
  const input = el('input', 'chat-input');
  input.maxLength = CHAT_MAX;
  input.placeholder = 'Say something...';
  input.autocomplete = 'off';
  input.enterKeyHint = 'send';
  const send = iconButton('chat-send', 'send', 'Send');
  send.type = 'submit';
  const close = iconButton('chat-close', 'close', 'Close chat', () => closeBar());
  bar.append(close, input, send);

  const emotes = el('div', 'emote-picker');
  emotes.hidden = true;
  for (const emote of EMOTES) {
    emotes.append(button('emote-option', emote.label, () => {
      emotes.hidden = true;
      onEmote(emote.id);
    }));
  }

  const chatButton = iconButton('dock-button', 'chat', 'Chat', () => {
    sfx.click();
    emotes.hidden = true;
    bar.hidden = false;
    log.classList.add('expanded');
    render();
    input.focus();
  });
  const emoteButton = iconButton('dock-button', 'emote', 'Emotes', () => {
    sfx.click();
    emotes.hidden = !emotes.hidden;
  });

  function closeBar() {
    bar.hidden = true;
    log.classList.remove('expanded');
    input.blur();
    render();
  }

  bar.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) onSend(text);
    input.value = '';
    closeBar();
  });

  function render() {
    const expanded = log.classList.contains('expanded');
    const now = Date.now();
    const shown = expanded ? history : history.slice(-VISIBLE_LINES).filter((l) => now - l.at < LINE_FADE_MS);
    log.replaceChildren(...shown.map((line) => {
      const row = el('div', `chat-line ${line.kind ?? ''}`);
      if (line.name) row.append(el('span', 'chat-name', `${line.name}: `));
      row.append(document.createTextNode(line.text));
      return row;
    }));
    log.scrollTop = log.scrollHeight;
  }
  setInterval(render, 2000);

  return {
    log,
    bar,
    emotes,
    chatButton,
    emoteButton,

    line({ name, text, kind }) {
      history.push({ name, text, kind, at: Date.now() });
      if (history.length > HISTORY) history.shift();
      render();
    },

    // The server's recent lines, on joining or after a reconnect.
    history(lines) {
      history.length = 0;
      for (const { name, text, at } of lines) history.push({ name, text, at: at ?? 0 });
      render();
    },

    isTyping() {
      return !bar.hidden;
    },
  };
}
