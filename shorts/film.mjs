#!/usr/bin/env node
// A film: shots made elsewhere (Higgsfield, or anything that hands back a
// video file) cut together with the kit's voices, sound, VHS static and
// titles. From the repo root:
//
//   npm run film -- the-itch           where it stands, and the cut: stills stand in for the
//                                      shots not filmed yet (the animatic)
//   npm run film -- the-itch --yes     first makes what's missing and costs money: painted key
//                                      frames, sounds, voices (it says how much before, without --yes)
//   npm run film -- the-itch --shots   the shot list to film from: each key frame, how long, the prompt
//
// A film is a folder, shorts/films/<name>/:
//   film.json   the cut list (lib/film.mjs says what goes in it)
//   frames/     a key frame per shot: the picture its video starts from
//   clips/      the videos, dropped in as <shot id>.mp4 (any size: they're fitted)
//   sounds/     the sounds made for it        voices/   its spoken lines
// Everything made is kept there and committed. To make one again, delete it.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captionsAss, captionsSrt } from './lib/captions.mjs';
import { readFilm, timing } from './lib/film.mjs';
import { duration, ffmpeg, finish, hasSound, hash, hashFile, join, startFrame, treatMusic, whole } from './lib/media.mjs';
import { dataUri, download, falRun, loadKeys } from './lib/services.mjs';

// (behind an HTTPS proxy, Node's fetch needs NODE_USE_ENV_PROXY=1: see make.mjs)
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const again = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(again.status ?? 1);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CACHE = path.join(HERE, 'out', '.cache');
const kit = JSON.parse(readFileSync(path.join(HERE, 'kit.json'), 'utf8'));
const cast = JSON.parse(readFileSync(path.join(HERE, 'cast.json'), 'utf8'));
const say = (...parts) => console.log(...parts);
const money = (n) => `$${n.toFixed(2)}`;
const VIDEO = (fps) => ['-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'];
const AUDIO = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];

function args(argv) {
  const opts = { film: null, yes: false, shots: false };
  for (const a of argv) {
    if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--shots') opts.shots = true;
    else if (!a.startsWith('-')) opts.film = a;
    else throw new Error(`Unknown option ${a}.`);
  }
  if (!opts.film) throw new Error('Which film? npm run film -- the-itch');
  return opts;
}

async function main() {
  const opts = args(process.argv.slice(2));
  const dir = existsSync(path.join(opts.film, 'film.json')) ? path.resolve(opts.film) : path.join(HERE, 'films', opts.film);
  const { film, errors } = readFilm(dir, cast);
  if (errors.length) throw new Error(`The film needs fixing:\n  ${errors.join('\n  ')}`);
  const slug = path.basename(dir);
  const size = kit.sizes[film.format ?? kit.format];
  if (!size) throw new Error(`format: ${film.format}? It's vertical or wide.`);
  const [W, H] = size;
  const { fps } = kit;
  const rel = (p) => path.relative(ROOT, p);
  // A path in the cut list: in the film's folder, in shorts/, or in the repo.
  const locate = (p) => [path.resolve(dir, p), path.resolve(HERE, p), path.resolve(ROOT, p)].find((c) => existsSync(c)) ?? null;
  const frameOf = (shot) => path.join(dir, 'frames', `${shot.id}.jpg`);
  const clipOf = (shot) => path.join(dir, 'clips', `${shot.id}.mp4`);
  const voiceOf = (shot) => path.join(dir, 'voices', `${shot.id}.mp3`);
  const madeSound = (name) => path.join(dir, 'sounds', `${name}.mp3`);
  const picture = (id, pose) => (pose ? locate(pose) : null)
    ?? ['png', 'jpg', 'jpeg', 'webp'].map((ext) => path.join(HERE, 'characters', `${id}.${ext}`)).find((f) => existsSync(f))
    ?? path.join(ROOT, 'packages/client/public/characters', `${id}.webp`);
  const filmed = film.shots.filter((s) => s.frame);

  // ---- the shot list, to film from
  if (opts.shots) {
    say(`${film.title}: ${filmed.length} shots to film, ${film.format ?? kit.format} (${W}x${H}). Start each from its key frame; save it as its clip.\n`);
    for (const shot of filmed) {
      const source = shot.seconds * (shot.speed ?? 1);
      say(`${shot.id}   ${shot.seconds}s in the cut${shot.speed ? ` (slowed: film ${source.toFixed(1)}s)` : ''}${existsSync(clipOf(shot)) ? '   FILMED' : ''}`);
      say(`  key frame: ${rel(frameOf(shot))}${existsSync(frameOf(shot)) ? '' : '  (not made yet)'}`);
      say(`  save as:   ${rel(clipOf(shot))}`);
      if (shot.camera) say(`  camera:    ${shot.camera}`);
      if (shot.prompt) say(`  prompt:    ${shot.prompt}${film.look ? ` ${film.look}` : ''}`);
      if (shot.voice) say(`  line:      ${cast[shot.voice.who].name}: "${shot.voice.say}"  (${rel(voiceOf(shot))}, at ${shot.voice.at ?? 0}s)`);
      if (shot.note) say(`  note:      ${shot.note}`);
      say('');
    }
    return;
  }

  mkdirSync(CACHE, { recursive: true });
  for (const sub of ['frames', 'clips', 'sounds', 'voices']) mkdirSync(path.join(dir, sub), { recursive: true });
  if (opts.yes) loadKeys(HERE);

  // ---- key frames: a character standing in a set that's already painted is
  // free (put together here); a new picture is painted (kit.json film).
  let toPaint = 0;
  for (const shot of filmed) {
    const file = frameOf(shot);
    if (existsSync(file)) continue;
    if (shot.frame.set) {
      const background = locate(shot.frame.set);
      if (!background) throw new Error(`${shot.id}: the set ${shot.frame.set} isn't there.`);
      const tall = H > W;
      startFrame({
        character: shot.frame.who ? picture(shot.frame.who, shot.frame.pose) : null, background, scene: true, size,
        height: shot.frame.height ?? (tall ? 0.58 : 0.85), bottom: shot.frame.bottom ?? (tall ? 0.82 : 0.96), across: shot.frame.across ?? 0.5, outFile: file,
      });
      say(`${shot.id}: key frame put together (${rel(file)}).`);
    } else if (opts.yes) {
      say(`${shot.id}: painting its key frame...`);
      const refs = (shot.frame.with ?? []).map((id) => {
        const flat = path.join(CACHE, `ref-${hashFile(picture(id))}.jpg`);  // (on plain grey, small: several go in one request)
        if (!existsSync(flat)) ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x808080:s=768x768', '-i', picture(id), '-filter_complex', '[1:v]scale=700:700:force_original_aspect_ratio=decrease[c];[0:v][c]overlay=(W-w)/2:(H-h)/2', '-frames:v', '1', '-q:v', '3', flat]);
        return dataUri(flat, 'image/jpeg');
      });
      const body = await falRun(refs.length ? kit.edit.model : kit.scene.model, {
        prompt: `${shot.frame.paint} ${kit.film.style}`, aspect_ratio: H > W ? '9:16' : '16:9', resolution: '2K', output_format: 'jpeg',
        ...(refs.length ? { image_urls: refs } : {}),
      });
      const url = body.images?.[0]?.url;
      if (!url) throw new Error(`${shot.id}: the image model didn't paint it (${JSON.stringify(body).slice(0, 200)}).`);
      const raw = `${file}.raw.jpg`;
      await download(url, raw);
      whole(file, (temp) => ffmpeg(['-i', raw, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, '-frames:v', '1', '-q:v', '2', '-f', 'image2', temp]));
      rmSync(raw, { force: true });
    } else toPaint++;
  }

  // ---- sounds: made once from their descriptions, or files, or the kit's music
  const soundFile = {};
  let soundSeconds = 0;
  for (const [name, s] of Object.entries(film.sounds ?? {})) {
    if (s.file) {
      soundFile[name] = locate(s.file);
      if (!soundFile[name]) throw new Error(`Sound "${name}": ${s.file} isn't there.`);
    } else if (s.music) {
      const track = kit.music.tracks[s.music];
      if (!track) throw new Error(`Sound "${name}": no music called ${s.music} in kit.json.`);
      const treated = path.join(CACHE, `music-${hash({ file: track.file, fx: track.fx ?? null })}.mp3`);
      if (!existsSync(treated)) treatMusic({ inFile: path.join(ROOT, track.file), fx: track.fx, outFile: treated });
      soundFile[name] = treated;
    } else if (existsSync(madeSound(name))) soundFile[name] = madeSound(name);
    else if (opts.yes) {
      say(`Making the sound "${name}": ${s.make}`);
      const body = await falRun(kit.sounds.model, { text: s.make, duration_seconds: s.seconds, loop: Boolean(s.loop), prompt_influence: s.influence ?? kit.sounds.influence ?? 0.5 });
      if (!body.audio?.url) throw new Error(`The sound model didn't make "${name}" (${JSON.stringify(body).slice(0, 200)}).`);
      const raw = `${madeSound(name)}.raw`;
      await download(body.audio.url, raw);
      whole(madeSound(name), (temp) => ffmpeg(['-i', raw, '-ar', '48000', '-c:a', 'libmp3lame', '-q:a', '2', '-f', 'mp3', temp]));
      rmSync(raw, { force: true });
      soundFile[name] = madeSound(name);
    } else soundSeconds += s.seconds;
  }

  // ---- voices: the kit's own (designed voice, ASMR, effects, chorus), one file a line
  const unsaid = film.shots.filter((s) => s.voice && !existsSync(voiceOf(s)));
  if (unsaid.length && opts.yes) {
    const script = path.join(CACHE, `${slug}-lines.txt`);
    writeFileSync(script, ['facing: front', 'mouth: 0', 'endcard: off', 'vhs: off', '',
      ...unsaid.map((s) => `${cast[s.voice.who].name.toUpperCase()}${s.voice.how ? ` (${s.voice.how})` : ''}: ${s.voice.say}`)].join('\n'));
    const out = path.join(CACHE, `${slug}-lines`);
    rmSync(out, { recursive: true, force: true });
    const run = spawnSync(process.execPath, [path.join(HERE, 'make.mjs'), script, '--lines', out], { stdio: 'inherit' });
    if (run.status !== 0) throw new Error("The lines couldn't be said (see above).");
    unsaid.forEach((s, i) => copyFileSync(path.join(out, `line-${i + 1}.mp3`), voiceOf(s)));
  }

  // ---- where it stands
  const { at, total } = timing(film);
  say(`\n${film.title}: ${film.shots.length} shots, ${total.toFixed(1)}s, ${film.format ?? kit.format}\n`);
  for (const shot of film.shots) {
    const what = shot.black ? 'black' : existsSync(clipOf(shot)) ? 'FILMED' : existsSync(frameOf(shot)) ? 'key frame (to film)' : 'no key frame yet';
    const line = shot.voice ? `  ${cast[shot.voice.who].name}: "${shot.voice.say}"${existsSync(voiceOf(shot)) ? '' : ' (not said yet)'}` : '';
    say(`  ${shot.id.padEnd(14)} ${at[shot.id].start.toFixed(1).padStart(5)}s  ${String(shot.seconds).padStart(4)}s  ${what}${line}`);
  }
  const stillUnsaid = film.shots.filter((s) => s.voice && !existsSync(voiceOf(s))).length;
  if (toPaint || soundSeconds || stillUnsaid) {
    const cost = toPaint * kit.scene.price + soundSeconds * kit.sounds.pricePerSecond + stillUnsaid * 0.02;
    say(`\nNot made yet: ${[toPaint && `${toPaint} key frames to paint`, soundSeconds && `${soundSeconds}s of sounds`, stillUnsaid && `${stillUnsaid} lines`].filter(Boolean).join(', ')}`
      + ` (about ${money(cost)} on fal). Run again with --yes to make them.`);
  }

  // ---- the cut
  const out = path.join(HERE, 'out', slug);
  mkdirSync(out, { recursive: true });
  const label = path.join(HERE, 'fonts', 'patrick-hand.ttf');
  const clips = [];
  let standIns = 0;
  film.shots.forEach((shot, i) => {
    const D = shot.seconds.toFixed(3);
    const outFile = path.join(out, `clip-${String(i + 1).padStart(2, '0')}.mp4`);
    const fades = [shot.fadeIn && `fade=t=in:st=0:d=${shot.fadeIn}`, shot.fadeOut && `fade=t=out:st=${(shot.seconds - shot.fadeOut).toFixed(3)}:d=${shot.fadeOut}`].filter(Boolean);
    const silence = ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
    let inputs;
    let picture;
    let sound = '[1:a]anull[a]';
    if (!shot.black && existsSync(clipOf(shot))) {
      const clip = clipOf(shot);
      const speed = shot.speed ?? 1;
      inputs = ['-i', clip, ...silence];
      picture = `[0:v]trim=start=${shot.from ?? 0},setpts=(PTS-STARTPTS)/${speed},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${D}`;
      if (shot.keepSound && hasSound(clip)) sound = `[0:a]atrim=start=${shot.from ?? 0},asetpts=PTS-STARTPTS,atempo=${speed},aresample=48000,aformat=channel_layouts=stereo,volume=${shot.keepSound === true ? 1 : shot.keepSound},apad[a]`;
    } else if (!shot.black && existsSync(frameOf(shot))) {
      // (not filmed yet: its key frame, drifting, marked as a stand-in)
      standIns++;
      const z = kit.film.drift ?? 0.07;
      const grow = shot.still === 'hold' ? '1' : shot.still === 'pull' ? `(1+${z}*(1-t/${D}))` : `(1+${z}*t/${D})`;
      inputs = ['-loop', '1', '-framerate', String(fps), '-i', frameOf(shot), ...silence];
      picture = `[0:v]scale=w='trunc(${W}*${grow}/2)*2':h=-2:eval=frame,crop=${W}:${H},setsar=1,`
        + `drawtext=fontfile='${label}':text='still  ${shot.id}':x=36:y=36:fontsize=${Math.round(H / 48)}:fontcolor=white@0.6:box=1:boxcolor=black@0.4:boxborderw=10`;
    } else {
      if (!shot.black) standIns++;
      inputs = ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}`, ...silence];
      picture = '[0:v]setsar=1';
    }
    ffmpeg([...inputs, '-filter_complex', `${[picture, ...fades].join(',')}[v];${sound}`, '-map', '[v]', '-map', '[a]', '-t', D, ...VIDEO(fps), ...AUDIO, outFile]);
    clips.push(outFile);
  });
  const joined = path.join(out, 'joined.mp4');
  join(clips, path.join(out, 'clips.txt'), joined);

  // The sound: every cue cut, levelled and faded into a file of its own, then laid in at its time.
  const hits = [];
  const lines = [];
  const bursts = [];
  let card = null;
  const lay = (name, where, cue) => {
    if (!soundFile[name]) return;  // (not made yet)
    const s = film.sounds[name];
    hits.push({ file: cueFile({ file: soundFile[name], peak: s.peak ?? null, loudness: s.loudness ?? null, ...cue }), at: where, volume: 1 });
  };
  for (const shot of film.shots) {
    const { start } = at[shot.id];
    for (const cue of shot.sound ?? []) lay(cue.name, start + (cue.at ?? 0), { seconds: cue.seconds ?? null, from: cue.from ?? 0, volume: cue.volume ?? 1, fadeIn: cue.fadeIn ?? 0.01, fadeOut: cue.fadeOut ?? 0.15 });
    if (shot.voice && existsSync(voiceOf(shot))) {
      const when = start + (shot.voice.at ?? 0);
      hits.push({ file: voiceOf(shot), at: when, volume: shot.voice.volume ?? 1 });
      lines.push({ start: when, end: Math.min(when + duration(voiceOf(shot)) + 0.3, total), who: cast[shot.voice.who].name, text: shot.voice.say });
    }
    if (shot.static) bursts.push([start, start + shot.seconds]);
    if (shot.staticIn) bursts.push([start, start + shot.staticIn]);
    if (shot.card && film.card) card = { start: start + 0.05, end: start + shot.seconds, title: film.card.title, line: film.card.line };
  }
  for (const bed of film.beds ?? []) {
    const from = at[bed.from].start + (bed.after ?? 0);
    lay(bed.name, from, { seconds: at[bed.to].end - from, loop: true, volume: bed.volume ?? 1, fadeIn: bed.fadeIn ?? 1, fadeOut: bed.fadeOut ?? 1 });
  }
  const ass = path.join(out, 'captions.ass');
  writeFileSync(ass, captionsAss({ size, lines: (film.captions ?? 'on') === 'off' ? [] : lines, names: false, show: null, title: null, endcard: card }));
  writeFileSync(path.join(out, `${slug}.srt`), captionsSrt(lines));
  const final = path.join(out, `${slug}${standIns ? '-animatic' : ''}.mp4`);
  finish({
    joined, ass, fontsDir: path.join(HERE, 'fonts'), music: null, hits, vhs: bursts.length ? { bursts, volume: kit.vhs.volume } : null,
    size, range: film.range ?? 16, total, outFile: final,
  });
  for (const clip of [...clips, joined]) rmSync(clip, { force: true });
  say(`\n${standIns ? `The animatic (${standIns} shots still to film; their key frames stand in)` : 'Done'}: ${rel(final)} (${duration(final).toFixed(1)}s)`);
  if (standIns) say(`The shot list to film from: npm run film -- ${slug} --shots`);
}

// A sound cue as a file: `seconds` of `file` from `from` (looped to length for
// a bed), brought to its level (a short sound by its peak, in dB; a long one
// by its loudness, in LUFS), times `volume`, faded in and out.
function cueFile({ file, seconds = null, from = 0, loop = false, peak = null, loudness = null, volume = 1, fadeIn = 0.01, fadeOut = 0.15 }) {
  const out = path.join(CACHE, `cue-${hash({ file: hashFile(file), seconds, from, loop, peak, loudness, volume, fadeIn, fadeOut, v: 1 })}.wav`);
  if (existsSync(out)) return out;
  if (loop && !seconds) throw new Error('A looped sound needs a length.');
  const cut = `${out}.cut.wav`;
  ffmpeg([...(loop ? ['-stream_loop', '-1'] : []), '-ss', from.toFixed(3), ...(seconds ? ['-t', seconds.toFixed(3)] : []), '-i', file, '-vn',
    '-af', 'aresample=48000,aformat=channel_layouts=stereo', '-c:a', 'pcm_s16le', '-f', 'wav', cut]);
  const length = duration(cut);
  let levelled;
  if (loudness != null && length >= 3) levelled = `loudnorm=I=${loudness}:TP=-2:LRA=20,aresample=48000`;
  else {
    const log = spawnSync('ffmpeg', ['-hide_banner', '-i', cut, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const loudest = Number(log.match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0);
    levelled = `volume=${((peak ?? -8) - loudest).toFixed(2)}dB`;
  }
  const out0 = Math.max(0, length - fadeOut);
  whole(out, (temp) => ffmpeg(['-i', cut, '-af', `${levelled},volume=${volume},afade=t=in:d=${fadeIn},afade=t=out:st=${out0.toFixed(3)}:d=${fadeOut}`, '-c:a', 'pcm_s16le', '-f', 'wav', temp]));
  rmSync(cut, { force: true });
  return out;
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
