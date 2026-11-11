// Puts the finished episodes on hairypopsicles.com/episodes: a web-sized copy
// of each (shorts/out/<name>/<name>.mp4, made with --yes), a poster frame and
// a line in site/episodes/episodes.json, which tools/site.mjs turns into the
// page. Episodes are the scripts called ep<number>-<name>.txt.
//
//   npm run episodes                 every finished episode (only what changed is redone)
//
// A script's poster: <seconds> picks the poster frame (40% in, otherwise).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScript } from './lib/script.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SITE = path.join(ROOT, 'site', 'episodes');
const MEDIA = path.join(SITE, 'media');
const cast = JSON.parse(readFileSync(path.join(HERE, 'cast.json'), 'utf8'));
const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-400)}`);
};
const seconds = (file) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim());
const hashFile = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);

mkdirSync(MEDIA, { recursive: true });
const listFile = path.join(SITE, 'episodes.json');
const before = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : [];
const episodes = [];
for (const file of readdirSync(path.join(HERE, 'scripts')).filter((f) => /^ep\d+-.+\.txt$/.test(f)).sort((a, b) => parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10))) {
  const slug = file.replace(/\.txt$/, '');
  const final = path.join(HERE, 'out', slug, `${slug}.mp4`);
  if (!existsSync(final)) {
    console.log(`${slug}: not made yet (npm run short -- shorts/scripts/${file} --yes), left off.`);
    continue;
  }
  const source = readFileSync(path.join(HERE, 'scripts', file), 'utf8');
  const { settings, shots } = parseScript(source, cast);
  const number = parseInt(slug.slice(2), 10);
  // The logline: the note at the top, after "episode N."
  const logline = (source.match(/^#\s*Hairy Popsicles, episode \d+\.\s*(.+)$/m)?.[1] ?? '').trim();
  const who = [...new Set(shots.flatMap((s) => s.cast).filter(Boolean))];
  const length = seconds(final);
  const at = Number(settings.poster ?? length * 0.4);
  const key = hashFile(final);
  const video = `${slug}.mp4`;
  const poster = `${slug}.jpg`;
  const old = before.find((e) => e.slug === slug);
  if (!old || old.source !== key || old.posterAt !== at || !existsSync(path.join(MEDIA, video))) {
    console.log(`${slug}: making the web copy and poster...`);
    // Small enough for phones on data, sharp enough for a big screen; starts playing before it's all loaded.
    ffmpeg(['-i', final, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-maxrate', '4000k', '-bufsize', '8000k', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', path.join(MEDIA, video)]);
    ffmpeg(['-ss', at.toFixed(2), '-i', final, '-frames:v', '1', '-vf', 'scale=720:1280', '-q:v', '3', path.join(MEDIA, poster)]);
  }
  episodes.push({
    number, slug, title: settings.title ?? slug, logline, cast: who, seconds: Math.round(length * 10) / 10,
    video, poster, posterAt: at, source: key,
  });
}
// Episodes whose scripts are gone leave the page too.
for (const old of before) if (!episodes.some((e) => e.slug === old.slug)) for (const f of [old.video, old.poster]) rmSync(path.join(MEDIA, f), { force: true });
// The link preview: the posters side by side.
if (episodes.length) {
  const shown = episodes.slice(0, 5);
  ffmpeg([...shown.flatMap((e) => ['-i', path.join(MEDIA, e.poster)]), '-filter_complex',
    `${shown.map((_, i) => `[${i}:v]scale=-1:630,crop=${Math.floor(1200 / shown.length)}:630[p${i}]`).join(';')};${shown.map((_, i) => `[p${i}]`).join('')}${shown.length > 1 ? `hstack=inputs=${shown.length},` : 'null,'}pad=1200:630:(ow-iw)/2:0:color=0x0e0608`,
    '-frames:v', '1', '-q:v', '3', path.join(MEDIA, 'og.jpg')]);
}
writeFileSync(listFile, `${JSON.stringify(episodes, null, 2)}\n`);
console.log(`site/episodes/episodes.json: ${episodes.length} episode${episodes.length === 1 ? '' : 's'}. tools/site.mjs builds the page from it.`);
