import { CHARACTERS } from '@hptm/shared';

// Drives the loading screen that index.html already shows.
const root = document.getElementById('loading');
const fill = root.querySelector('.load-fill');
const status = root.querySelector('.load-status');
const retry = root.querySelector('.load-retry');
const quote = root.querySelector('.load-quote');

export function randomQuote() {
  const speakers = CHARACTERS.filter((c) => c.lines);
  const who = speakers[Math.floor(Math.random() * speakers.length)];
  return { text: who.lines[Math.floor(Math.random() * who.lines.length)], name: who.name };
}

function showQuote() {
  const { text, name } = randomQuote();
  quote.textContent = `"${text}"`;
  const by = document.createElement('span');
  by.textContent = `— ${name}`;
  quote.append(by);
}

export const loading = {
  show(text) {
    retry.hidden = true;
    status.textContent = text;
    showQuote();
    root.hidden = false;
    root.classList.remove('done');
  },
  progress(share) {
    fill.style.width = `${Math.round(share * 100)}%`;
  },
  status(text) {
    status.textContent = text;
  },
  error(text, onRetry) {
    status.textContent = text;
    retry.hidden = false;
    retry.onclick = () => {
      retry.hidden = true;
      onRetry();
    };
  },
  hide() {
    root.classList.add('done');
    setTimeout(() => { if (root.classList.contains('done')) root.hidden = true; }, 500);
  },
};

showQuote();
