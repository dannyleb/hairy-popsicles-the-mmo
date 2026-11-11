// Puts hairypopsicles.com together from the built game: the hub (site/) at the
// root and the game in /the-mmo/. GitHub Pages publishes the result.
//
//   npm run site                  build the game for /the-mmo/ and put the site together in _site/
//   npm run site -- --serve       ...then serve it at http://localhost:4173/ for a look
//
// Options: --dist (the built game, packages/client/dist), --out (_site),
// --site-url (where the site is served, for link previews; its path is the
// site's base), --server (the game server, for "N playing now"; defaults to
// packages/client/.env.production), --serve [port].
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTER_BY_ID, CHARACTERS, RARITIES, RARITY_ORDER } from '@hptm/shared';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const serving = args.includes('--serve');
const port = Number(option('serve', 4173));
const dist = path.resolve(ROOT, option('dist', 'packages/client/dist'));
const out = path.resolve(ROOT, option('out', '_site'));
const site = new URL(option('site-url', `http://localhost:${port}/`));
const base = site.pathname.endsWith('/') ? site.pathname : `${site.pathname}/`;
const server = new URL(option('server', readFileSync(path.join(ROOT, 'packages/client/.env.production'), 'utf8').match(/^VITE_SERVER_URL=(.+)$/m)[1].trim()));
const serverHttp = `${server.protocol === 'wss:' ? 'https:' : 'http:'}//${server.host}`;
const GAME = 'the-mmo';
const SHOTS = ['world', 'boil', 'reveal', 'album', 'night'];

if (!existsSync(path.join(dist, 'index.html'))) throw new Error(`No built game in ${dist}: run npm run build -w @hptm/client -- --base=${base}${GAME}/ first`);

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fill = (file, values) => readFileSync(path.join(ROOT, 'site', file), 'utf8')
  .replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`site/${file}: nothing for {{${key}}}`);
    return values[key];
  });

// Every character, in album order, a row per rarity; the Legendaries stay silhouettes.
const card = (c) => {
  const secret = c.rarity === 'legendary';
  const alt = secret ? 'A Legendary, still a silhouette' : escape(c.name);
  return `          <li class="card${secret ? ' secret' : ''}"><img src="${GAME}/characters/small/${c.id}.webp" alt="${alt}" width="256" height="256" loading="lazy"><span class="card-name">${secret ? '???' : escape(c.name)}</span></li>`;
};
const cast = RARITY_ORDER.map((rarity) => {
  const members = CHARACTERS.filter((c) => c.rarity === rarity);
  return [
    `      <div class="tier r-${rarity}">`,
    `        <h3 class="tier-title">${RARITIES[rarity].label} <span>${members.length}</span></h3>`,
    '        <ul class="cast-list">',
    ...members.map(card),
    '        </ul>',
    '      </div>',
  ].join('\n');
}).join('\n');
const counts = RARITY_ORDER.map((r) => `${CHARACTERS.filter((c) => c.rarity === r).length} ${RARITIES[r].label}`);
const castCounts = `${CHARACTERS.length} of them: ${counts.slice(0, -1).join(', ')} and ${counts.at(-1)}.`;

// The show: hairypopsicles.com/episodes, from site/episodes/episodes.json
// (npm run episodes puts the finished episodes there).
const SHOW = path.join(ROOT, 'site', 'episodes');
const show = existsSync(path.join(SHOW, 'episodes.json')) ? JSON.parse(readFileSync(path.join(SHOW, 'episodes.json'), 'utf8')) : [];
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const nameOf = (id) => CHARACTER_BY_ID[id]?.name ?? id;
const episodeCard = (e, i) => {
  const next = show[i + 1];
  const cast = e.cast.map((id) => `            <li><img src="../${GAME}/characters/small/${id}.webp" alt="" width="34" height="34" loading="lazy"><span>${escape(nameOf(id))}</span></li>`).join('\n');
  return [
    `      <article class="ep" id="ep-${e.number}">`,
    '        <div class="ep-screen">',
    `          <video class="ep-video" src="media/${e.video}" poster="media/${e.poster}" preload="none" playsinline width="720" height="1280"></video>`,
    `          <span class="ep-badge">Ep ${e.number}</span>`,
    `          <span class="ep-time">${clock(e.seconds)}</span>`,
    `          <button class="ep-play" type="button" aria-label="Play episode ${e.number}: ${escape(e.title)}"></button>`,
    '          <div class="ep-next" hidden>',
    next ? `            <p class="ep-next-text">Next in <span class="ep-next-count">5</span><b>${escape(next.title)}</b></p>` : '            <p class="ep-next-text"><span class="ep-next-count"></span></p>',
    '            <button class="ep-next-go" type="button">Play</button>',
    '            <button class="ep-next-stay" type="button">Stay</button>',
    '          </div>',
    '        </div>',
    '        <div class="ep-info">',
    `          <p class="ep-num">Episode ${e.number} · ${clock(e.seconds)}</p>`,
    `          <h2 class="ep-title">${escape(e.title)}</h2>`,
    e.logline ? `          <p class="ep-logline">${escape(e.logline)}</p>` : '',
    `          <ul class="ep-cast" aria-label="Starring">\n${cast}\n          </ul>`,
    '          <button class="ep-share" type="button">Copy link</button>',
    '        </div>',
    '      </article>',
  ].filter(Boolean).join('\n');
};
// ...and a row of them on the hub, linking in.
const teaser = show.length ? [
  '    <section class="show-teaser" aria-labelledby="show-title">',
  '      <p class="kicker">now showing</p>',
  '      <h2 class="section-title" id="show-title">The Show</h2>',
  `      <p class="section-lead">Tiny, wet, wrong little films about the cast and their bad luck. ${show.length} episode${show.length === 1 ? '' : 's'}, under a minute each.</p>`,
  '      <ul class="show-row">',
  ...show.map((e) => `        <li><a href="episodes/#ep-${e.number}"><img src="episodes/media/${e.poster}" alt="Episode ${e.number}: ${escape(e.title)}" width="720" height="1280" loading="lazy"><span>${escape(e.title)}</span></a></li>`),
  '      </ul>',
  '      <a class="pill pill-ghost" href="episodes/">Watch the episodes</a>',
  '    </section>',
].join('\n') : '';

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'img', 'shots'), { recursive: true });
cpSync(dist, path.join(out, GAME), { recursive: true });
for (const file of ['go.js', 'hub.js', 'hub.css']) cpSync(path.join(ROOT, 'site', file), path.join(out, file));
cpSync(path.join(ROOT, 'site', 'img'), path.join(out, 'img'), { recursive: true });
for (const shot of SHOTS) cpSync(path.join(ROOT, 'docs', 'screenshots', `${shot}.jpg`), path.join(out, 'img', 'shots', `${shot}.jpg`));
writeFileSync(path.join(out, 'index.html'), fill('index.html', { SITE: site.href, SERVER: serverHttp, CAST: cast, CAST_COUNTS: castCounts, SHOW: teaser }));
if (show.length) {
  mkdirSync(path.join(out, 'episodes'), { recursive: true });
  for (const file of ['episodes.css', 'episodes.js']) cpSync(path.join(SHOW, file), path.join(out, 'episodes', file));
  cpSync(path.join(SHOW, 'media'), path.join(out, 'episodes', 'media'), { recursive: true });
  writeFileSync(path.join(out, 'episodes', 'index.html'), fill('episodes/index.html', { SITE: site.href, COUNT: `${show.length} episode${show.length === 1 ? '' : 's'}`, EPISODES: show.map(episodeCard).join('\n') }));
}
writeFileSync(path.join(out, '404.html'), fill('404.html', { BASE: base }));
// Copies of the game from before /the-mmo/, still at the old address on
// players' phones, look for this to know the new home is up, then hand their
// save to the root (go.js sends it on). Theirs checks for base "/", so it's
// only written once the site is built for the domain's root: before that, the
// game here isn't built for where it's served yet.
if (base === '/') writeFileSync(path.join(out, 'home.json'), JSON.stringify({ game: 'hairy-popsicles-mmo', base: '/' }));
console.log(`Site in ${path.relative(ROOT, out)}/: the hub at ${site.href}, the game at ${site.href}${GAME}/`);

if (serving) {
  // Like GitHub Pages: files as they are (readable from any site), folders by
  // their index.html (a folder without its slash is sent to it), and 404.html
  // for anything else.
  const TYPES = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.txt': 'text/plain',
  };
  createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(out, decodeURIComponent(url.pathname.slice(base.length - 1)));
    if (!file.startsWith(out)) file = out;
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        res.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
        return;
      }
      file = path.join(file, 'index.html');
    }
    const found = existsSync(file) && statSync(file).isFile();
    res.writeHead(found ? 200 : 404, { 'Content-Type': found ? TYPES[path.extname(file)] ?? 'application/octet-stream' : 'text/html', 'Access-Control-Allow-Origin': '*' });
    res.end(readFileSync(found ? file : path.join(out, '404.html')));
  }).listen(port, () => console.log(`Serving at http://localhost:${port}${base}`));
}
