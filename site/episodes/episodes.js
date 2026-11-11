// hairypopsicles.com/episodes: one episode plays at a time; when one ends,
// the next one is offered (and starts by itself after a few seconds);
// "Copy link" copies a link straight to that episode.
const episodes = [...document.querySelectorAll('.ep')];
const UP_NEXT_SECONDS = 5;

function stopOthers(current) {
  for (const ep of episodes) {
    if (ep === current) continue;
    const video = ep.querySelector('video');
    if (!video.paused) video.pause();
    cancelNext(ep);
  }
}

function play(ep) {
  const video = ep.querySelector('video');
  video.controls = true;
  ep.classList.add('playing');
  stopOthers(ep);
  video.play().catch(() => {});  // (a browser that wants a tap first shows its own controls)
}

function cancelNext(ep) {
  const next = ep.querySelector('.ep-next');
  clearInterval(next.timer);
  next.hidden = true;
}

function offerNext(ep) {
  const after = episodes[episodes.indexOf(ep) + 1];
  if (!after) return;
  const next = ep.querySelector('.ep-next');
  const count = next.querySelector('.ep-next-count');
  let left = UP_NEXT_SECONDS;
  count.textContent = left;
  next.hidden = false;
  clearInterval(next.timer);
  next.timer = setInterval(() => {
    left -= 1;
    count.textContent = left;
    if (left <= 0) go(ep, after);
  }, 1000);
}

function go(from, to) {
  cancelNext(from);
  to.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  play(to);
}

for (const ep of episodes) {
  const video = ep.querySelector('video');
  ep.querySelector('.ep-play').addEventListener('click', () => play(ep));
  video.addEventListener('play', () => {
    ep.classList.add('playing');
    stopOthers(ep);
    cancelNext(ep);
  });
  video.addEventListener('ended', () => offerNext(ep));
  const next = ep.querySelector('.ep-next');
  next.querySelector('.ep-next-go').addEventListener('click', () => go(ep, episodes[episodes.indexOf(ep) + 1]));
  next.querySelector('.ep-next-stay').addEventListener('click', () => cancelNext(ep));

  const share = ep.querySelector('.ep-share');
  share.addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}#${ep.id}`;
    try {
      await navigator.clipboard.writeText(link);
      share.textContent = 'Link copied';
    } catch {
      share.textContent = link;
    }
    setTimeout(() => { share.textContent = 'Copy link'; }, 2400);
  });
}
