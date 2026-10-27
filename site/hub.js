// The hub: how many are in the world right now (which also wakes the game
// server early), and the bar with a Play button once the big one is out of sight.
const server = document.body.dataset.server;
const live = document.querySelector('.live');
fetch(`${server}/stats`, { cache: 'no-store' })
  .then((res) => (res.ok ? res.json() : null))
  .then((stats) => {
    if (!Number.isInteger(stats?.online)) return;
    live.textContent = stats.online > 0 ? `${stats.online} playing now` : 'Quiet right now. Be the first in.';
    live.classList.toggle('on', stats.online > 0);
    live.hidden = false;
  })
  .catch(() => {});

const bar = document.querySelector('.bar');
const button = document.querySelector('.now .pill-big');
new IntersectionObserver(([entry]) => bar.classList.toggle('on', !entry.isIntersecting && entry.boundingClientRect.top < 0))
  .observe(button);
