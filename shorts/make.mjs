#!/usr/bin/env node
// Script in, short out. From the repo root:
//
//   npm run short -- shorts/scripts/lost-eye.txt          voices, a preview cut, and what the video would cost
//   npm run short -- shorts/scripts/lost-eye.txt --yes    ...and the real thing (pays for the video shots)
//   npm run short -- shorts/scripts/lost-eye.txt --yes --redo 3,5    new takes of shots 3 and 5
//   npm run short -- shorts/scripts/lost-eye.txt --revoice 2         say line 2 again
//   npm run short -- shorts/scripts/lost-eye.txt --offline           no services at all (placeholder voices)
//   npm run short -- --design conehead,redeye     design those characters' voices from their briefs (or "all")
//   npm run short -- --pose conehead,redeye       draw them turned left and right (or "all")
//   npm run short -- --voices                     the stock ElevenLabs voices on your account
//
// Everything made is kept (shorts/out/.cache), keyed by what went into it,
// so running again only makes what changed: edit one line and only that
// line's voice and shot are made again.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captionsAss, captionsSrt } from './lib/captions.mjs';
import { CHARACTER_BY_ID } from '../packages/shared/src/characters.js';
import {
  KEYS, applyFx, composite, duration, ffmpeg, finish, hasSound, hash, hashFile, join, layer, onKey, startFrame, stillClip, treatMusic,
} from './lib/media.mjs';
import { pose, posePath } from './lib/poses.mjs';
import { findCharacter, parseScript } from './lib/script.mjs';
import {
  audioTags, changeVoice, dataUri, download, falChangeVoice, falDesignVoice, falSpeak, falVideo, findVoice, listVoices, loadKeys, speak,
} from './lib/services.mjs';

// Behind an HTTPS proxy (a Claude cloud session, some offices), Node's fetch
// only uses it when started with NODE_USE_ENV_PROXY=1 (Node 22.21+): so start again with it.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const again = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(again.status ?? 1);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CACHE = path.join(HERE, 'out', '.cache');
const CONCURRENT = 3;          // video shots made at once
// Quiet after each line before the cut, by how it ends: cut off mid-word
// ("—") goes straight on, trailing off ("...") lingers.
const tailFor = (text) => (/(—|--)\s*$/.test(text) ? 0.02 : /(\.\.\.|…)\s*$/.test(text) ? 0.7 : 0.25);
const WORDS_PER_SECOND = 2.6;  // for placeholder voices (--offline)

const kit = JSON.parse(readFileSync(path.join(HERE, 'kit.json'), 'utf8'));
const cast = JSON.parse(readFileSync(path.join(HERE, 'cast.json'), 'utf8'));
const VOICES_FILE = path.join(HERE, 'voices.json');
const designed = existsSync(VOICES_FILE) ? JSON.parse(readFileSync(VOICES_FILE, 'utf8')) : {};
const say = (...parts) => console.log(...parts);
const money = (n) => `$${n.toFixed(2)}`;

function args(argv) {
  const opts = { script: null, yes: false, offline: false, voices: false, design: null, pose: null, redo: new Set(), revoice: new Set() };
  const shots = (v) => new Set(String(v ?? '').split(',').map(Number).filter((n) => n > 0));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--offline') opts.offline = true;
    else if (a === '--voices') opts.voices = true;
    else if (a === '--design') opts.design = String(argv[++i] ?? '');
    else if (a === '--pose') opts.pose = String(argv[++i] ?? '');
    else if (a === '--redo') opts.redo = shots(argv[++i]);
    else if (a === '--revoice') opts.revoice = shots(argv[++i]);
    else if (!a.startsWith('-')) opts.script = a;
    else throw new Error(`Unknown option ${a}.`);
  }
  return opts;
}

// Where a path in a script or the cast points: relative to shorts/, or the repo, or absolute.
function locate(p) {
  for (const candidate of [path.resolve(HERE, p), path.resolve(ROOT, p), path.resolve(p)]) if (existsSync(candidate)) return candidate;
  return null;
}

function characterImage(id) {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const own = path.join(HERE, 'characters', `${id}.${ext}`);
    if (existsSync(own)) return own;
  }
  if (cast[id].image) {
    const given = locate(cast[id].image);
    if (!given) throw new Error(`${cast[id].name}'s image (${cast[id].image}) isn't there.`);
    return given;
  }
  return path.join(ROOT, 'packages/client/public/characters', `${id}.webp`);
}

function backgroundImage(setting) {
  const named = { surface: 'packages/client/public/world/ground.webp', skin: 'packages/client/public/world/ground.webp', deep: 'packages/client/public/world/deep-ground.webp' };
  if (!setting || setting === 'black' || setting === 'dark') return null;
  const p = named[setting] ? path.join(ROOT, named[setting]) : locate(setting);
  if (!p) throw new Error(`The background "${setting}" isn't a file (or one of surface, deep, black).`);
  return p;
}

async function pool(items, size, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

// ---------- designed voices ----------

// Whose voice a character speaks in (the snoots share one).
const voiceOwner = (id) => cast[id].voiceOf ?? id;

// What a new voice says while it's being designed: the character's own lines
// from the game, topped up to the 100+ characters the designer likes.
function sampleFor(id) {
  const lines = CHARACTER_BY_ID[id]?.lines ?? [];
  let text = lines.join(' ');
  const filler = ["Come closer. Closer. Do you want to see what's growing out of me? It's fine. It's normal. Everyone has one.", 'Hello. Yes, you. Have you been looking at me this whole time?'];
  for (const more of filler) if (text.length < 120) text = `${text} ${more}`.trim();
  return text;
}

// Designs `id`'s voice from its brief and saves it in voices.json. Returns
// the sample it said, with the character's effects on, for auditioning.
async function designVoice(id, outDir) {
  const { name, brief, fx = [] } = cast[id];
  if (!brief) throw new Error(`${name} has no voice brief in cast.json to design from.`);
  say(`Designing ${name}'s voice...`);
  const { voiceId, sampleUrl } = await falDesignVoice({ model: kit.voice.design, brief, sample: sampleFor(id), name: `HP ${name}` });
  designed[id] = { voiceId, brief, designed: new Date().toISOString().slice(0, 10) };
  writeFileSync(VOICES_FILE, `${JSON.stringify(designed, null, 2)}\n`);
  mkdirSync(outDir, { recursive: true });
  const raw = path.join(outDir, `${id}-raw.mp3`);
  const sample = path.join(outDir, `${id}.mp3`);
  await download(sampleUrl, raw);
  applyFx(raw, sample, fx);
  rmSync(raw, { force: true });
  return sample;
}

async function designVoices(which) {
  const ids = which === 'all'
    ? Object.keys(cast).filter((id) => id !== '_' && !cast[id].voiceOf)
    : which.split(',').map((w) => findCharacter(w, cast) ?? (() => { throw new Error(`Nobody called "${w}" in the cast.`); })()).map(voiceOwner);
  const outDir = path.join(HERE, 'out', 'voices');
  const samples = [];
  for (const id of [...new Set(ids)]) samples.push(await designVoice(id, outDir));
  // All of them in one file, a second apart, to listen through.
  const reel = path.join(outDir, 'audition.mp3');
  const inputs = samples.flatMap((f) => ['-i', f]);
  const graph = `${samples.map((_, i) => `[${i}:a]aresample=44100,apad=pad_dur=1[a${i}]`).join(';')};${samples.map((_, i) => `[a${i}]`).join('')}concat=n=${samples.length}:v=0:a=1[x]`;
  ffmpeg([...inputs, '-filter_complex', graph, '-map', '[x]', '-c:a', 'libmp3lame', '-q:a', '3', reel]);
  say(`\nAudition: ${path.relative(ROOT, reel)}  (${[...new Set(ids)].map((id) => cast[id].name).join(', ')}, in that order)`);
  say('Not right? Edit the brief (or fx) in shorts/cast.json and design it again.');
}

// Where a character stands and how big, by which side it's on and whether
// it shares the shot: { cx, bottom, width, height } in px.
function place([W, H], side, pair) {
  const tall = H > W;
  if (pair) {
    const cx = side === 'right' ? 0.73 : side === 'left' ? 0.27 : 0.5;
    return tall
      ? { cx: W * cx, bottom: H * 0.74, width: W * 0.5, height: H * 0.36 }
      : { cx: W * (side === 'right' ? 0.7 : 0.3), bottom: H * 0.92, width: W * 0.4, height: H * 0.7 };
  }
  const cx = side === 'left' ? 0.42 : side === 'right' ? 0.58 : 0.5;
  return tall
    ? { cx: W * cx, bottom: H * 0.82, width: W * 0.86, height: H * 0.58 }
    : { cx: W * (side === 'left' ? 0.4 : side === 'right' ? 0.6 : 0.5), bottom: H * 0.96, width: W * 0.6, height: H * 0.85 };
}
const facingFor = (side) => (side === 'left' ? 'right' : side === 'right' ? 'left' : 'front');
const keyFor = (ids) => (ids.some((id) => cast[id].key === 'blue') ? 'blue' : 'green');

// Characters turned left and right (for the show), drawn now with a contact sheet to check them.
async function drawPoses(which) {
  const ids = which === 'all' ? Object.keys(cast).filter((id) => id !== '_') : which.split(',').map((w) => findCharacter(w, cast) ?? (() => { throw new Error(`Nobody called "${w}" in the cast.`); })());
  const outDir = path.join(HERE, 'out', 'poses');
  mkdirSync(outDir, { recursive: true });
  const size = [1500, 560 * ids.length];
  const chars = [];
  for (const [row, id] of ids.entries()) {
    for (const [col, facing] of ['left', 'front', 'right'].entries()) {
      const image = await pose({ here: HERE, id, facing, picture: characterImage(id), key: keyFor([id]), model: kit.edit.model, say });
      chars.push({ image, cx: 250 + col * 500, bottom: 540 + row * 560, width: 460, height: 520 });
    }
  }
  const sheetLayer = path.join(outDir, 'sheet.png');
  layer({ chars, size, outFile: sheetLayer });
  const sheet = path.join(outDir, 'sheet.jpg');
  ffmpeg(['-f', 'lavfi', '-i', `color=c=0x1e1014:s=${size[0]}x${size[1]}`, '-i', sheetLayer, '-filter_complex', '[0:v][1:v]overlay', '-frames:v', '1', '-q:v', '3', sheet]);
  rmSync(sheetLayer, { force: true });
  say(`\nPoses (facing left, the camera, right): ${path.relative(ROOT, sheet)}`);
}

async function main() {
  const opts = args(process.argv.slice(2));
  loadKeys(HERE);
  if (opts.voices) {
    for (const v of await listVoices()) say(`${v.name.padEnd(48)} ${v.category ?? ''}`);
    return;
  }
  if (opts.design) return designVoices(opts.design);
  if (opts.pose) return drawPoses(opts.pose);
  if (!opts.script) throw new Error('Which script? npm run short -- shorts/scripts/<name>.txt');
  const scriptFile = locate(opts.script);
  if (!scriptFile) throw new Error(`No script at ${opts.script}.`);
  const { settings, shots, errors } = parseScript(readFileSync(scriptFile, 'utf8'), cast);
  if (errors.length) throw new Error(`The script needs fixing:\n  ${errors.join('\n  ')}`);

  const slug = path.basename(scriptFile).replace(/\.[^.]+$/, '');
  const out = path.join(HERE, 'out', slug);
  mkdirSync(out, { recursive: true });
  mkdirSync(CACHE, { recursive: true });
  const format = settings.format ?? kit.format;
  const size = kit.sizes[format];
  if (!size) throw new Error(`format: ${format}? It's vertical or wide.`);
  const [W, H] = size;
  const { fps } = kit;
  const background = backgroundImage(settings.background ?? kit.background);
  const cached = (name) => path.join(CACHE, name);
  // Music: one of kit.json's tracks (treated once and kept), a file, or none.
  const musicName = settings.music ?? kit.music.default;
  let music = null;
  if (musicName && musicName !== 'none') {
    const preset = kit.music.tracks[musicName];
    const file = preset ? path.join(ROOT, preset.file) : locate(musicName);
    if (!file || !existsSync(file)) throw new Error(`The music "${musicName}" isn't one of ${Object.keys(kit.music.tracks).join(', ')}, or a file (put it in shorts/music/).`);
    music = cached(`music-${hash({ file: hashFile(file), fx: preset?.fx ?? null })}.mp3`);
    if (!existsSync(music)) treatMusic({ inFile: file, fx: preset?.fx, outFile: music });
  }
  const ambienceName = settings.ambience ?? kit.ambience.default;
  const ambience = ambienceName && ambienceName !== 'none' ? kit.ambience.beds[ambienceName] : null;
  if (ambienceName && ambienceName !== 'none' && !ambience) throw new Error(`The ambience "${ambienceName}" isn't one of ${Object.keys(kit.ambience.beds).join(', ')}.`);
  const drawing = opts.yes && !opts.offline;  // poses are drawn (and paid for) only for the real thing

  // The still background every shot sits on.
  const plate = cached(`plate-${hash({ background: background && hashFile(background), size })}.jpg`);
  if (!existsSync(plate)) startFrame({ character: null, background, size, outFile: plate });

  // Who stands where: with two or more in the skit, the first to appear stands
  // on the left facing right, the next on the right facing left, and so on.
  // Alone (or with "facing: front"), they face the camera in the middle.
  const order = [...new Set(shots.flatMap((s) => s.cast))];
  // Said off screen: heard over whoever was on screen last (or is next), not the talker.
  for (const [i, shot] of shots.entries()) {
    shot.visual = shot.cast;
    if (!shot.notes.off) continue;
    const others = (s) => !s.notes.off && s.cast.length && !(s.cast.length === 1 && s.cast[0] === shot.who);
    const near = [...shots.slice(0, i)].reverse().find(others) ?? shots.slice(i + 1).find(others);
    shot.visual = near ? near.cast : shot.cast;
  }
  const together = order.length > 1 && settings.facing !== 'front';
  const sideOf = Object.fromEntries(order.map((id, i) => [id, together ? (i % 2 ? 'right' : 'left') : 'front']));
  let posesToDraw = 0;
  say(`\n${settings.title ?? slug}: ${shots.length} shots, ${format}${opts.offline ? ' (offline)' : ''}\n`);
  for (const shot of shots) {
    shot.character = shot.who === 'scene' ? null : cast[shot.who];
    shot.label = `#${shots.indexOf(shot) + 1} ${shot.cast.map((id) => cast[id].name).join(' & ') || 'Scene'}`;
    const pair = shot.visual.length === 2;
    const sides = pair ? ['left', 'right'] : shot.visual.map((id) => shot.notes.side ?? sideOf[id]);
    const chars = [];
    for (const [i, id] of shot.visual.entries()) {
      const facing = pair && shot.notes.side === 'front' ? 'front' : facingFor(sides[i]);
      const picture = characterImage(id);
      if (!existsSync(picture)) throw new Error(`No picture of ${cast[id].name} (${picture}).`);
      let image = picture;
      if (facing !== 'front') {
        if (existsSync(posePath(HERE, id, facing))) image = posePath(HERE, id, facing);
        else if (drawing) image = await pose({ here: HERE, id, facing, picture, key: keyFor([id]), model: kit.edit.model, say });
        else posesToDraw++;  // (the preview makes do with the picture as it is)
      }
      chars.push({ image, ...place(size, sides[i], pair) });
    }
    shot.key = keyFor(shot.visual);
    // A held picture (a beat, or a line said off screen) creeps in unless told otherwise.
    if ((shot.notes.still || shot.notes.off) && !shot.notes.camera.length) shot.notes.camera = ['push'];
    const layerKey = hash({ chars: chars.map((c) => ({ ...c, image: hashFile(c.image) })), size });
    shot.layer = cached(`layer-${layerKey}.png`);
    if (!existsSync(shot.layer)) layer({ chars, size, outFile: shot.layer });
    shot.start = cached(`start-${hash({ layerKey, key: shot.key })}.jpg`);
    shot.startKey = hash({ layerKey, key: shot.key });
    const lead = chars[0];
    shot.focus = lead ? [pair ? W / 2 : lead.cx, lead.bottom - lead.height * 0.55] : [W / 2, H / 2];
    if (shot.kind !== 'talk') shot.seconds = shot.notes.seconds ?? (shot.notes.still ? 1.5 : kit.action.seconds);
  }

  // ---- voices
  const provider = opts.offline ? 'offline' : kit.voice.provider;
  const stock = provider === 'elevenlabs' && shots.some((s) => s.kind === 'talk') ? await listVoices() : [];
  let voiceChars = 0;
  for (const shot of shots.filter((s) => s.kind === 'talk')) {
    // How it's said: the line's own notes, or else how this character always talks.
    const c = shot.character;
    const direction = shot.notes.direction.join(', ') || c.manner || '';
    const take = shot.notes.take && locate(shot.notes.take);
    if (shot.notes.take && !take) throw new Error(`${shot.label}: the take ${shot.notes.take} isn't there (put recordings in shorts/takes/).`);
    let voiceId = 'offline';
    if (provider === 'fal') {
      const owner = voiceOwner(shot.who);
      if (!designed[owner]) await designVoice(owner, path.join(HERE, 'out', 'voices'));
      voiceId = designed[owner].voiceId;
    } else if (provider === 'elevenlabs') {
      voiceId = findVoice(stock, c.voice ?? '')?.id;
      if (!voiceId) throw new Error(`${c.name}'s voice "${c.voice}" isn't on your ElevenLabs account. Pick one from: npm run short -- --voices`);
    }
    const stability = c.stability ?? kit.voice.stability;
    const fx = c.fx ?? [];
    const voiceKey = hash({ provider, text: shot.text, direction, voiceId, take: take && hashFile(take), stability, fx, v: 3 });
    shot.audio = cached(`voice-${voiceKey}.mp3`);
    if (opts.revoice.has(shots.indexOf(shot) + 1)) rmSync(shot.audio, { force: true });
    if (!existsSync(shot.audio)) {
      const raw = `${shot.audio}.raw.mp3`;
      if (provider === 'offline') {
        const seconds = Math.max(1.2, shot.text.split(/\s+/).length / WORDS_PER_SECOND);
        ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', seconds.toFixed(2), '-c:a', 'libmp3lame', raw]);
      } else if (take) {
        say(`${shot.label}: turning your take into ${c.name}'s voice...`);
        if (provider === 'fal') await falChangeVoice({ model: kit.voice.changer, inFile: take, voiceId, outFile: raw });
        else await changeVoice({ inFile: take, voiceId, model: kit.voice.elevenlabs.changerModel, format: kit.voice.elevenlabs.format, outFile: raw });
      } else {
        say(`${shot.label}: "${shot.text}"${direction ? ` (${direction})` : ''}`);
        const text = direction ? `${audioTags(direction)} ${shot.text}` : shot.text;
        voiceChars += text.length;
        if (provider === 'fal') await falSpeak({ model: kit.voice.tts, text, voiceId, stability, outFile: raw });
        else await speak({ text: shot.text, direction, voiceId, model: kit.voice.elevenlabs.model, format: kit.voice.elevenlabs.format, outFile: raw });
      }
      if (provider === 'offline') renameSync(raw, shot.audio);  // (silence: nothing to treat)
      else applyFx(raw, shot.audio, fx);
      rmSync(raw, { force: true });
    }
    shot.seconds = Math.max(duration(shot.audio) + tailFor(shot.text), shot.notes.off ? 0.6 : kit.talking.minSeconds);
  }
  if (voiceChars && provider === 'fal') say(`(voices: ${voiceChars} characters, about ${money((voiceChars / 1000) * kit.voice.pricePer1000)})`);

  // ---- what each shot's video is, and what's still to make
  for (const shot of shots) {
    if (shot.notes.still || shot.notes.off) {
      shot.price = 0;
      continue;
    }
    const looks = shot.cast.map((id) => cast[id].look);
    const look = looks.join(' and ') || 'the scene';
    const direction = shot.notes.direction.join(', ');
    const flat = `The plain flat ${KEYS[shot.key].css} background stays perfectly flat and still; the camera does not move.`;
    const lipsync = shot.kind === 'talk' && shot.character.lipsync !== false;
    if (lipsync) {
      shot.model = kit.talking.model;
      shot.prompt = `${look}, talking${direction ? `, ${direction}` : ''}. ${kit.style} ${flat}`;
      shot.billed = shot.seconds;
      shot.price = shot.billed * kit.talking.pricePerSecond;
    } else {
      // An action shot, or someone with no mouth to sync talking over one.
      shot.model = kit.action.model;
      const doing = shot.kind === 'talk' ? `talking, moving as it speaks${direction ? `, ${direction}` : ''}` : `${shot.text}${direction ? `, ${direction}` : ''}`;
      shot.prompt = `${shot.cast.length ? `${look}: ` : ''}${doing}. ${kit.style} ${flat}`;
      shot.billed = Math.min(15, Math.max(3, Math.ceil(shot.seconds)));
      shot.price = shot.billed * kit.action.pricePerSecond * (shot.notes.sound ? 1.5 : 1);
    }
    shot.videoKey = hash({ model: shot.model, start: shot.startKey, audio: lipsync ? hashFile(shot.audio) : null, prompt: shot.prompt, billed: shot.billed, sound: shot.notes.sound });
    shot.video = cached(`shot-${shot.videoKey}.mp4`);
    if (opts.redo.has(shots.indexOf(shot) + 1)) rmSync(shot.video, { force: true });
    shot.lipsync = lipsync;
  }
  const made = (s) => s.notes.still || s.notes.off || existsSync(s.video);
  const toMake = shots.filter((s) => !made(s));
  const poseCost = posesToDraw * kit.edit.price;
  const cost = toMake.reduce((sum, s) => sum + s.price, 0);
  say('');
  for (const s of shots) {
    const what = s.notes.still ? 'beat  ' : s.notes.off ? 'off   ' : s.kind === 'talk' ? 'talks ' : 'action';
    const state = s.notes.still || s.notes.off ? 'held (free)' : made(s) ? 'made' : `to make, about ${money(s.price)}`;
    say(`  ${s.label.padEnd(26)} ${what} ${s.seconds.toFixed(1).padStart(5)}s  ${state}`);
  }

  // ---- the video shots (only with --yes: they cost money)
  const failed = [];
  let broke = null;  // out of credit: no point sending the rest
  if (opts.yes && toMake.length && !opts.offline) {
    say(`\nMaking ${toMake.length} video shot${toMake.length > 1 ? 's' : ''} on fal, about ${money(cost)}. A few minutes each; ${CONCURRENT} at a time.\n`);
    await pool(toMake, CONCURRENT, async (shot) => {
      if (broke) {
        failed.push(shot);
        return;
      }
      const started = Date.now();
      try {
        if (!existsSync(shot.start)) onKey({ layerFile: shot.layer, key: shot.key, size, outFile: shot.start });
        const input = shot.lipsync
          ? { image_url: dataUri(shot.start, 'image/jpeg'), audio_url: dataUri(shot.audio, 'audio/mpeg'), prompt: shot.prompt }
          : {
              start_image_url: dataUri(shot.start, 'image/jpeg'), prompt: shot.prompt, duration: String(shot.billed),
              generate_audio: shot.notes.sound, negative_prompt: kit.action.negative,
            };
        await falVideo({ model: shot.model, input, outFile: shot.video, onStatus: (s) => say(`  ${shot.label}: ${s}`) });
        say(`  ${shot.label}: done in ${Math.round((Date.now() - started) / 1000)}s`);
      } catch (error) {
        failed.push(shot);
        if (/out of credit/.test(error.message)) {
          if (!broke) say(`\n  ${error.message}\n  Nothing was charged. Stopping here.`);
          broke = error;
        } else {
          say(`  ${shot.label}: FAILED. ${error.message}`);
        }
      }
    });
  }

  // ---- the cut: each shot over the still background, video where it's made
  const clips = [];
  const lines = [];
  let t = 0;
  for (const shot of shots) {
    const clip = path.join(out, `clip-${String(shots.indexOf(shot) + 1).padStart(2, '0')}.mp4`);
    const video = !shot.notes.still && !shot.notes.off && existsSync(shot.video) ? shot.video : null;
    const keepSound = Boolean(video) && shot.notes.sound && shot.kind === 'action' && hasSound(video);
    composite({
      plate, video, still: video ? null : shot.layer, key: shot.key, camera: shot.notes.camera, focus: shot.focus,
      audio: shot.audio ?? null, keepSound, seconds: shot.seconds, size, fps, outFile: clip,
    });
    const length = duration(clip);
    if (shot.kind === 'talk') lines.push({ start: t + 0.05, end: t + length - 0.1, who: shot.character.name, text: shot.text.replace(/\[[^\]]*\]\s*/g, '') });
    clips.push(clip);
    t += length;
  }
  let endcard = null;
  if ((settings.endcard ?? 'on') !== 'off' && kit.endcard) {
    const card = path.join(out, 'clip-end.mp4');
    stillClip({ frame: plate, audio: null, seconds: kit.endcard.seconds, size, fps, outFile: card });
    endcard = { start: t, end: t + kit.endcard.seconds, title: kit.endcard.title, line: kit.endcard.line };
    clips.push(card);
    t += duration(card);
  }
  const joined = path.join(out, 'joined.mp4');
  join(clips, path.join(out, 'clips.txt'), joined);
  const captions = settings.captions ?? kit.captions;
  const ass = path.join(out, 'captions.ass');
  writeFileSync(ass, captionsAss({ size, lines: captions !== 'off' ? lines : [], names: captions === 'names', show: kit.show, title: settings.title, endcard }));
  writeFileSync(path.join(out, `${slug}.srt`), captionsSrt(lines));
  const allMade = shots.every(made) && !posesToDraw;
  const final = path.join(out, `${slug}${allMade ? '' : '-preview'}.mp4`);
  finish({ joined, ass, fontsDir: path.join(HERE, 'fonts'), music, musicVolume: kit.music.volume, ambience, total: t, outFile: final });
  for (const clip of [...clips, joined]) rmSync(clip, { force: true });

  say(`\n${allMade ? 'Done' : 'Preview (stills where the video shots will go)'}: ${path.relative(ROOT, final)} (${t.toFixed(1)}s)`);
  if (failed.length && broke) say('No video shots were made: top up fal, then run this again with --yes (the voices are already made).');
  else if (failed.length) say(`${failed.length} shot${failed.length > 1 ? 's' : ''} failed (${failed.map((s) => s.label).join(', ')}): they're stills for now. Run again with --yes to retry them.`);
  const left = shots.filter((s) => !made(s));
  if ((left.length || posesToDraw) && !opts.yes) {
    const parts = [left.length && `${left.length} video shot${left.length > 1 ? 's' : ''}`, posesToDraw && `${posesToDraw} turned pose${posesToDraw > 1 ? 's' : ''}`].filter(Boolean);
    say(`To make the ${parts.join(' and ')} (about ${money(left.reduce((sum, s) => sum + s.price, 0) + poseCost)} on fal), run it again with --yes.`);
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
