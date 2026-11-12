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
  KEYS, MASTER_LOUDNESS, applyFx, brokenVoice, composite, setCloseMic, duration, ffmpeg, finish, hasSound, hash, hashFile, imageSize, join, layer, level, onKey, opaqueBox, startFrame, stillClip, treatMusic,
} from './lib/media.mjs';
import { flipPose, pose, posePath, propImage, propPath, wearing, wearingPath } from './lib/poses.mjs';
import { scene, scenePath } from './lib/scenes.mjs';
import { ROOMS, roomResponse, sound, soundPath } from './lib/sounds.mjs';
import { asmrVoice, mouthSounds } from './lib/asmr.mjs';
import { mouthClip, mouthClipPath, mouthInsert, mouthStill, mouthStillPath, salivaBed } from './lib/mouth.mjs';
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
// The gap after a line: none if it's cut off, a long one if it trails away,
// otherwise kit.pace.gap (short: the show doesn't wait around).
const tailFor = (text) => (/(—|--)\s*$/.test(text) ? 0.02 : /(\.\.\.|…)\s*$/.test(text) ? 0.7 : kit.pace.gap);
const WORDS_PER_SECOND = 2.6;  // for placeholder voices (--offline)

const kit = JSON.parse(readFileSync(path.join(HERE, 'kit.json'), 'utf8'));
if (kit.voice.asmr) setCloseMic(kit.voice.asmr.chain);
const cast = JSON.parse(readFileSync(path.join(HERE, 'cast.json'), 'utf8'));
const VOICES_FILE = path.join(HERE, 'voices.json');
const designed = existsSync(VOICES_FILE) ? JSON.parse(readFileSync(VOICES_FILE, 'utf8')) : {};
const say = (...parts) => console.log(...parts);
const money = (n) => `$${n.toFixed(2)}`;

function args(argv) {
  const opts = { script: null, yes: false, offline: false, voices: false, design: null, pose: null, flip: null, mouth: null, redo: new Set(), revoice: new Set() };
  const shots = (v) => new Set(String(v ?? '').split(',').map(Number).filter((n) => n > 0));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--offline') opts.offline = true;
    else if (a === '--voices') opts.voices = true;
    else if (a === '--design') opts.design = String(argv[++i] ?? '');
    else if (a === '--pose') opts.pose = String(argv[++i] ?? '');
    else if (a === '--flip') opts.flip = String(argv[++i] ?? '');
    else if (a === '--mouth') opts.mouth = String(argv[++i] ?? '');
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
// (`asmr`: the character's soft-spoken ASMR voice, a second design kept
// beside the first as "<id>~asmr".)
async function designVoice(id, outDir, asmr = null) {
  const { name, fx = [] } = cast[id];
  const brief = asmr ? `${cast[id].asmrBrief ?? cast[id].brief} ${asmr.brief}` : cast[id].brief;
  const key = asmr ? `${id}~asmr` : id;
  if (!cast[id].brief) throw new Error(`${name} has no voice brief in cast.json to design from.`);
  say(`Designing ${name}'s ${asmr ? 'ASMR ' : ''}voice...`);
  const { voiceId, sampleUrl } = await falDesignVoice({ model: kit.voice.design, brief, sample: sampleFor(id), name: `HP ${hash(key).slice(0, 6)}` });  // (a label only: some names, like Shiv, trip the content filter)
  designed[key] = { voiceId, brief, designed: new Date().toISOString().slice(0, 10) };
  // Merged into what's on disk now, not what was there when this run began:
  // two episodes made at once mustn't wipe each other's new voices.
  const saved = existsSync(VOICES_FILE) ? JSON.parse(readFileSync(VOICES_FILE, 'utf8')) : {};
  writeFileSync(VOICES_FILE, `${JSON.stringify({ ...saved, [key]: designed[key] }, null, 2)}\n`);
  mkdirSync(outDir, { recursive: true });
  const raw = path.join(outDir, `${key}-raw.mp3`);
  const sample = path.join(outDir, `${key}.mp3`);
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
// Random numbers that come out the same every time for the same seed (so a
// remade episode jolts and crackles in the same places).
function seeded(seed) {
  let n = parseInt(hash(seed).slice(0, 8), 16);
  return () => ((n = (n * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Yelled lines get the camera slamming in and shaking whether the script says so or not.
const yelled = (shot) => shot.kind === 'talk' && (/scream|shout|yell|shriek/i.test(shot.notes.direction.join(' ')) || (/!/.test(shot.text) && shot.text.replace(/[^a-z]/gi, '').length > 3 && shot.text === shot.text.toUpperCase()));

// VHS static every so often (kit.vhs.every seconds apart, give or take),
// each burst kit.vhs.length long, only in the quiet stretches between lines,
// and the same every time the episode is made.
function staticBursts(quiet, { every: [lo, hi], length: [short, long], after = 1.5 }, seed) {
  const random = seeded(seed);
  const bursts = [];
  let next = after + random() * (hi - lo);
  for (const [from, to] of quiet) {
    if (to < next) continue;
    const start = Math.max(from, next);
    const end = Math.min(to, start + short + random() * (long - short));
    if (end - start < 0.1) continue;
    bursts.push([start, end]);
    next = end + lo + random() * (hi - lo);
  }
  return bursts;
}

// Where a picture laid out at `c` touches the floor: its bottom, less any
// empty space at the bottom of the picture.
const floors = new Map();
function floorOf(c) {
  if (!floors.has(c.image)) {
    const [iw, ih] = imageSize(c.image);
    const [, y, , h] = opaqueBox(c.image);
    floors.set(c.image, { iw, ih, gap: ih - y - h });
  }
  const { iw, ih, gap } = floors.get(c.image);
  return c.bottom - gap * Math.min(c.width / iw, c.height / ih);
}
// A character's mouth close-up settings: kit.mouth, with their own prompts for
// the still and the clip if cast.json gives them (mouthStill, mouthClip: Shiv's
// close-up is of the hotdog in his mouth).
const wetOf = (shot) => shot.cast.find((id) => cast[id].mouthful) ?? shot.who;
// (cast.json mouthful: a direction for the voice model, or { tags, pause }:
// pause is a tag put in at every break between sentences, e.g. [chews])
const mouthfulOf = (c) => (!c?.mouthful ? null : typeof c.mouthful === 'string' ? { tags: c.mouthful } : c.mouthful);
// A wet shot (> NAME (2s, wet)) and every line a mouthful character says get
// the saliva sounds of their mouth close-up under them.
const isWet = (shot) => shot.notes.wet || (shot.kind === 'talk' && Boolean(mouthfulOf(shot.character)));
const mouthSettings = (id) => ({ ...kit.mouth, ...(cast[id]?.mouthStill ? { still: cast[id].mouthStill } : {}), ...(cast[id]?.mouthClip ? { clip: cast[id].mouthClip } : {}) });
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
  if (opts.mouth) {
    // --mouth conehead,bigeye: make characters' mouth close-ups ahead of time.
    for (const name of opts.mouth.split(',')) {
      const id = findCharacter(name, cast);
      if (!id) throw new Error(`Nobody called "${name}" in the cast.`);
      const where = { here: HERE, id, settings: mouthSettings(id), say };
      const still = await mouthStill({ ...where, picture: characterImage(id), size: kit.sizes[kit.format] });
      const clip = await mouthClip({ ...where, still, negative: kit.action.negative });
      say(`${cast[id].name}'s mouth: ${path.relative(ROOT, clip)}`);
    }
    return;
  }
  if (opts.flip) {
    // --flip snoot-right: mirror a turned picture that faces the wrong way.
    for (const name of opts.flip.split(',')) {
      const file = path.join(HERE, 'characters', 'poses', `${name.replace(/\.webp$/, '')}.webp`);
      if (!existsSync(file)) throw new Error(`No turned picture called ${name} (they're in shorts/characters/poses/).`);
      flipPose(file);
      say(`Mirrored ${path.relative(ROOT, file)}. Shots with it in are remade next time (with --yes).`);
    }
    return;
  }
  if (!opts.script) throw new Error('Which script? npm run short -- shorts/scripts/<name>.txt');
  const scriptFile = locate(opts.script);
  if (!scriptFile) throw new Error(`No script at ${opts.script}.`);
  const { settings, shots, errors } = parseScript(readFileSync(scriptFile, 'utf8'), cast);
  if (errors.length) throw new Error(`The script needs fixing:\n  ${errors.join('\n  ')}`);

  const slug = path.basename(scriptFile).replace(/\.[^.]+$/, '');
  // saliva: shiv (or several, comma-separated): the sound of their mouth
  // close-up under the whole episode, at one level (instead of under
  // their own shots only, which switches on and off).
  const saliva = (settings.saliva && settings.saliva !== 'off' ? settings.saliva.split(',') : []).map((w) => findCharacter(w.trim(), cast) ?? (() => { throw new Error(`saliva: nobody called "${w.trim()}" in the cast.`); })());
  // ASMR mouth close-ups (kit.mouth): a script's own `> NAME (1.5s, mouth)`,
  // plus kit.mouth.auto more dropped at random into pauses (after a silent
  // beat or a line that trails off...), the same places every time. A
  // script's mouth: N sets how many, mouth: off none.
  if (kit.mouth && (settings.mouth ?? 'on') !== 'off') {
    const count = /^\d+$/.test(settings.mouth ?? '') ? Number(settings.mouth) : kit.mouth.auto;
    const pick = seeded(`${slug}-mouth`);
    const spots = shots.map((s, i) => [s, i]).filter(([s, i]) => i > 0 && i < shots.length - 1 && s.who !== 'scene' && !s.prop && s.cast.length === 1 && cast[s.who]?.lipsync !== false
      && !s.notes.mouth && !shots[i + 1].notes.mouth && (s.notes.still || (s.kind === 'talk' && /(\.\.\.|…)\s*$/.test(s.text))));
    const chosen = [];
    while (chosen.length < count && spots.length) chosen.push(spots.splice(Math.floor(pick() * spots.length), 1)[0]);
    const [lo, hi] = kit.mouth.seconds;
    for (const [s, i] of chosen.sort((a, b) => b[1] - a[1])) {
      shots.splice(i + 1, 0, {
        n: s.n, line: '(a mouth close-up)', kind: 'action', who: s.who, cast: [s.who], text: '',
        notes: { seconds: Number((lo + pick() * (hi - lo)).toFixed(2)), take: null, sound: false, still: false, mouth: true, off: false, camera: [], side: null, with: null, wearing: null, direction: [] },
      });
    }
  }
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
  // The episode's own environment (its sounds: line), made once for a few cents;
  // the made-up ambience beds are for scripts without one.
  let sounds = null;
  if (settings.sounds) {
    const where = { here: HERE, name: slug, description: settings.sounds, seconds: kit.sounds.seconds, loop: true, settings: kit.sounds, say };
    const file = existsSync(soundPath(where)) ? soundPath(where) : opts.offline ? null : await sound(where);
    const loudness = kit.voice.asmr && (settings.asmr ?? 'on') !== 'off' ? kit.voice.asmr.bedLoudness ?? kit.sounds.loudness : kit.sounds.loudness;  // (lower under ASMR voices, so the little sounds read)
    if (file) sounds = { file: level({ inFile: file, loudness, outFile: cached(`sounds-${hash({ file: hashFile(file), loudness })}.mp3`) }), volume: 1 };
  }
  const ambienceName = settings.ambience ?? (settings.sounds ? 'none' : kit.ambience.default);
  const ambience = ambienceName && ambienceName !== 'none' ? kit.ambience.beds[ambienceName] : null;
  if (ambienceName && ambienceName !== 'none' && !ambience) throw new Error(`The ambience "${ambienceName}" isn't one of ${Object.keys(kit.ambience.beds).join(', ')}.`);
  const drawing = opts.yes && !opts.offline;  // poses are drawn (and paid for) only for the real thing
  const roomName = settings.room ?? kit.room;
  const dry = kit.voice.asmr && (settings.asmr ?? 'on') !== 'off' ? kit.voice.asmr.room : 1;  // (ASMR is close and dry)
  const room = roomName && roomName !== 'none' ? { response: roomResponse({ room: roomName, outFile: cached(`room-${roomName}-${hash(ROOMS[roomName] ?? roomName)}.wav`) }), level: ROOMS[roomName].level * dry } : null;
  const frantic = (settings.energy ?? kit.energy.default) === 'frantic';
  const random = seeded(`${slug}-camera`);

  // The still background every shot sits on: the episode's own painted scene
  // (made with --yes; the preview stands in the plain background meanwhile).
  let backdrop = background;
  let painted = false;
  let sceneToPaint = false;
  if (settings.scene) {
    const where = { here: HERE, slug, description: settings.scene, format, settings: kit.scene };
    if (existsSync(scenePath(where))) backdrop = scenePath(where);
    else if (drawing) backdrop = await scene({ ...where, size, say });
    else sceneToPaint = true;
    painted = backdrop !== background;
  }
  const plate = cached(`plate-${hash({ background: backdrop && hashFile(backdrop), painted, size })}.jpg`);
  if (!existsSync(plate)) startFrame({ character: null, background: backdrop, scene: painted, size, outFile: plate });

  // Who stands where: with two or more in the skit, the first to appear stands
  // on the left facing right, the next on the right facing left, and so on.
  // Alone (or with "facing: front"), they face the camera in the middle.
  const order = [...new Set(shots.flatMap((s) => s.cast))];
  // What's in the picture: who's in the shot, with what. Said off screen, a
  // line is heard over whoever (or whatever) was on screen last, or is next.
  for (const [i, shot] of shots.entries()) {
    shot.visual = shot.cast;
    shot.look = { prop: shot.prop ?? null, with: shot.notes.with, wearing: shot.notes.wearing };
    if (!shot.notes.off) continue;
    const others = (s) => !s.notes.off && !s.notes.mouth && (s.prop || (s.cast.length && !(s.cast.length === 1 && s.cast[0] === shot.who)));
    const near = [...shots.slice(0, i)].reverse().find(others) ?? shots.slice(i + 1).find(others);
    if (near) {
      shot.visual = near.cast;
      shot.look = { prop: near.prop ?? null, with: near.notes.with, wearing: near.notes.wearing };
    }
  }
  // Props and characters wearing them: drawn once (with --yes; the preview
  // leaves the prop out meanwhile, and shows the character without it).
  const undrawn = new Set();  // props and wearing pictures the preview did without
  const propFile = async (name) => {
    const where = { here: HERE, name, description: settings.props[name], style: kit.props.style, model: kit.props.model, say };
    if (existsSync(propPath(where))) return propPath(where);
    if (drawing) return propImage(where);
    undrawn.add(propPath(where));
    return null;
  };
  const wornBy = async (id, facing, picture, prop) => {
    const where = { here: HERE, id, facing, picture, prop, description: settings.props[prop], key: keyFor([id]), model: kit.edit.model, say };
    if (existsSync(wearingPath(where))) return wearingPath(where);
    if (drawing) return wearing(where);
    undrawn.add(wearingPath(where));
    return picture;
  };
  const together = order.length > 1 && settings.facing !== 'front';
  const sideOf = Object.fromEntries(order.map((id, i) => [id, together ? (i % 2 ? 'right' : 'left') : 'front']));
  const posesUndrawn = new Set();  // turned pictures the preview did without
  say(`\n${settings.title ?? slug}: ${shots.length} shots, ${format}${opts.offline ? ' (offline)' : ''}\n`);
  for (const shot of shots) {
    shot.character = shot.who === 'scene' ? null : cast[shot.who];
    shot.label = `#${shots.indexOf(shot) + 1} ${shot.cast.map((id) => cast[id].name).join(' & ') || (shot.prop ? `The ${shot.prop}` : 'Scene')}`;
    if (shot.notes.mouth) {  // (cut from the character's mouth clip, below)
      shot.label += "'s mouth";
      shot.seconds = shot.notes.seconds ?? kit.mouth.seconds[0];
      shot.mouthClip = mouthClipPath(HERE, shot.who, mouthSettings(shot.who));
      continue;
    }
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
        else posesUndrawn.add(posePath(HERE, id, facing));  // (the preview makes do with the picture as it is)
      }
      if (shot.look.wearing) image = await wornBy(id, facing, image, shot.look.wearing);
      chars.push({ image, ...place(size, sides[i], pair) });
    }
    const [W2, H2] = size;
    if (shot.look.prop) {
      const image = await propFile(shot.look.prop);
      if (image) chars.push({ image, cx: W2 / 2, bottom: H2 * 0.68, width: W2 * 0.8, height: H2 * 0.38 });
    }
    // (a prop held out in front is nearer the camera, so their shadow is what counts)
    shot.base = chars.length ? Math.max(...chars.map(floorOf)) : null;
    if (shot.look.with) {
      const image = await propFile(shot.look.with);
      const by = chars[0];
      if (image) chars.push({ image, cx: pair || !by ? W2 / 2 : by.cx, bottom: H2 * (pair ? 0.8 : 0.93), width: W2 * 0.38, height: H2 * 0.13 });
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
    // The voice comes from where they stand (off screen: from their side).
    const from = shot.notes.off ? { left: 0.15, right: 0.85 }[sideOf[shot.who]] ?? 0.5 : lead ? lead.cx / W : 0.5;
    const spread = kit.voice.asmr && (settings.asmr ?? 'on') !== 'off' ? kit.voice.asmr.spread : 0.6;  // (wider in headphones for ASMR)
    shot.pan = Math.max(-spread, Math.min(spread, (from - 0.5) * 2 * spread));
    if (yelled(shot)) for (const move of ['punch', 'shake']) if (!shot.notes.camera.includes(move)) shot.notes.camera.push(move);
    if (shot.kind !== 'talk') shot.seconds = shot.notes.seconds ?? (shot.notes.still ? 1.5 : kit.action.seconds);
  }

  // ---- voices
  const provider = opts.offline ? 'offline' : kit.voice.provider;
  // ASMR (kit.voice.asmr; a script's asmr: off turns it off): lines are
  // whispered, close to the mic, with mouth sounds. Yelled lines stay yelled.
  const asmr = kit.voice.asmr && (settings.asmr ?? 'on') !== 'off' ? kit.voice.asmr : null;
  const mouth = asmr ? await mouthSounds({ here: HERE, cacheDir: CACHE, asmr, soundSettings: kit.sounds, offline: provider === 'offline', say }) : {};
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
      const key = asmr && !yelled(shot) ? `${owner}~asmr` : owner;
      const stale = key !== owner && designed[key] && !designed[key].brief.endsWith(asmr.brief);  // (the ASMR direction changed: design it again)
      if (!designed[key] || stale) await designVoice(owner, path.join(HERE, 'out', 'voices'), key === owner ? null : asmr);
      voiceId = designed[key].voiceId;
    } else if (provider === 'elevenlabs') {
      voiceId = findVoice(stock, c.voice ?? '')?.id;
      if (!voiceId) throw new Error(`${c.name}'s voice "${c.voice}" isn't on your ElevenLabs account. Pick one from: npm run short -- --voices`);
    }
    const stability = c.stability ?? kit.voice.stability;
    const soft = asmr && !yelled(shot);
    // (whispered, a character keeps their pitch, not the effects that muffle or thicken: the mouth sounds do that)
    const fx = soft ? (c.fx ?? []).filter((f) => asmr.keepFx.includes(f)) : c.fx ?? [];
    // (cast.json mouthful: they talk with something in their mouth: told so, and muffled after)
    const after = [...(soft ? ['closeMic'] : []), ...(c.mouthful ? ['muffled'] : [])];
    const voiceKey = hash({ provider, text: shot.text, direction, voiceId, take: take && hashFile(take), stability, fx, v: 3, ...(c.mouthful ? { mouthful: c.mouthful } : {}), ...(soft ? { asmr: { tags: asmr.tags, chain: asmr.chain, mouth: asmr.mouth, lead: asmr.lead, tail: asmr.tail, pause: asmr.pause, level: asmr.mouthLevel } } : {}) });
    // (the ASMR voices' close-mic treatment is kit.voice.asmr.chain, applied as the closeMic effect)
    shot.audio = cached(`voice-${voiceKey}.mp3`);
    if (opts.revoice.has(shots.indexOf(shot) + 1)) rmSync(shot.audio, { force: true });
    if (existsSync(shot.audio) && provider !== 'offline' && brokenVoice(shot.audio)) {
      say(`${shot.label}: its voice came out broken last time (silent, or a flat hum): making it again.`);
      rmSync(shot.audio, { force: true });
    }
    // (the take itself, before any effects, is kept: changing a character's
    // effects treats the same performance again instead of recording a new one)
    const full = mouthfulOf(c);
    const said = full?.pause ? shot.text.replace(/([.?!…]) +(?=\S)/g, `$1 ${full.pause} `) : shot.text;
    const text = [soft ? asmr.tags : '', full?.tags ?? '', direction ? audioTags(direction) : '', said].filter(Boolean).join(' ');
    const takeFile = cached(`take-${hash({ provider, voiceId, stability, take: take && hashFile(take), text: take ? null : text })}.mp3`);
    if (opts.revoice.has(shots.indexOf(shot) + 1)) rmSync(takeFile, { force: true });  // (--revoice: a new performance, too)
    for (let attempt = 1; !existsSync(shot.audio); attempt++) try {
      const raw = provider === 'offline' ? `${shot.audio}.raw.mp3` : takeFile;
      if (provider === 'offline') {
        const seconds = Math.max(1.2, shot.text.split(/\s+/).length / WORDS_PER_SECOND);
        ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', seconds.toFixed(2), '-c:a', 'libmp3lame', raw]);
      } else if (existsSync(raw)) {
        say(`${shot.label}: treating the take again (${[...fx, ...after].join(', ') || 'no effects'})...`);
      } else if (take) {
        say(`${shot.label}: turning your take into ${c.name}'s voice...`);
        if (provider === 'fal') await falChangeVoice({ model: kit.voice.changer, inFile: take, voiceId, outFile: raw });
        else await changeVoice({ inFile: take, voiceId, model: kit.voice.elevenlabs.changerModel, format: kit.voice.elevenlabs.format, outFile: raw });
      } else {
        say(`${shot.label}: "${shot.text}"${direction ? ` (${direction})` : ''}`);
        voiceChars += text.length;
        if (provider === 'fal') await falSpeak({ model: kit.voice.tts, text, voiceId, stability, outFile: raw });
        else await speak({ text: shot.text, direction, voiceId, model: kit.voice.elevenlabs.model, format: kit.voice.elevenlabs.format, outFile: raw });
      }
      if (provider === 'offline') renameSync(raw, shot.audio);  // (silence: nothing to treat)
      else if (soft && Object.keys(mouth).length) {
        const speech = `${shot.audio}.speech.mp3`;
        applyFx(raw, speech, fx);
        asmrVoice({ speech, mouth, seed: `${slug}-${shots.indexOf(shot)}`, asmr, outFile: shot.audio });
        rmSync(speech, { force: true });
      } else applyFx(raw, shot.audio, [...fx, ...after]);
    } catch (error) {
      // (a line the effects broke gets one more go, as a new take)
      if (attempt > 1 || !/broke a line/.test(error.message)) throw error;
      rmSync(takeFile, { force: true });
      say(`${shot.label}: ${error.message.split('.')[0]}. Trying a new take.`);
    }
    shot.seconds = Math.max(duration(shot.audio) + tailFor(shot.text), shot.notes.off ? 0.6 : kit.talking.minSeconds);
  }
  if (voiceChars && provider === 'fal') say(`(voices: ${voiceChars} characters, about ${money((voiceChars / 1000) * kit.voice.pricePer1000)})`);

  // The frenzy (energy: frantic): the camera never quite holds still, and
  // snaps in at random while anyone's moving. Silent beats only tremble: the
  // stillness is the joke.
  if (frantic) {
    const { jitter, jolts: { every: [lo, hi], size: [small, big] } } = kit.energy;
    for (const shot of shots) {
      shot.jitter = shot.notes.mouth ? 0 : shot.notes.still ? jitter / 2 : jitter;
      shot.jolts = [];
      if (shot.notes.still || shot.notes.mouth || shot.notes.camera.includes('close')) continue;
      for (let at = 0.25 + random() * lo; at < shot.seconds - 0.2; at += lo + random() * (hi - lo)) shot.jolts.push([at, small + random() * (big - small)]);
    }
  }

  // ---- what each shot's video is, and what's still to make
  const mouthsToMake = new Set();
  const needMouths = [
    ...shots.filter((s) => s.notes.mouth || (isWet(s) && !saliva.length)).map((s) => (s.notes.mouth ? s.who : wetOf(s))),  // (a wet shot needs its character's clip for the sound)
    ...saliva,
  ];
  for (const id of needMouths) {
    if (existsSync(mouthClipPath(HERE, id, mouthSettings(id))) || mouthsToMake.has(id)) continue;
    if (drawing) {
      const where = { here: HERE, id, settings: mouthSettings(id), say };
      const still = await mouthStill({ ...where, picture: characterImage(id), size });
      await mouthClip({ ...where, still, negative: kit.action.negative });
    } else mouthsToMake.add(id);
  }
  for (const shot of shots) {
    if (shot.notes.still || shot.notes.off || shot.notes.mouth) {
      shot.price = 0;
      continue;
    }
    const looks = shot.cast.map((id) => cast[id].look + (shot.look.wearing ? `, wearing ${settings.props[shot.look.wearing]}` : ''));
    if (shot.look.prop) looks.push(settings.props[shot.look.prop]);
    if (shot.look.with) looks.push(`with ${settings.props[shot.look.with]} in front of them`);
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
      shot.prompt = `${looks.length ? `${look}: ` : ''}${doing}. ${kit.style} ${flat}`;
      shot.billed = Math.min(15, Math.max(3, Math.ceil(shot.seconds)));
      shot.price = shot.billed * kit.action.pricePerSecond * (shot.notes.sound ? 1.5 : 1);
    }
    shot.videoKey = hash({ model: shot.model, start: shot.startKey, audio: lipsync ? hashFile(shot.audio) : null, prompt: shot.prompt, billed: lipsync ? null : shot.billed, sound: shot.notes.sound });
    // The lip-sync model sometimes writes its own garbled subtitles of the
    // line under the face. Told not to (an instruction to the model, not part
    // of what the shot is: shots already made stay as they are).
    shot.instruction = lipsync ? `${shot.prompt} ${kit.talking.noText}` : shot.prompt;
    shot.video = cached(`shot-${shot.videoKey}.mp4`);
    if (opts.redo.has(shots.indexOf(shot) + 1)) rmSync(shot.video, { force: true });
    shot.lipsync = lipsync;
  }
  const made = (s) => s.notes.still || s.notes.off || (s.notes.mouth ? existsSync(s.mouthClip) : existsSync(s.video));
  const toMake = shots.filter((s) => !made(s) && !s.notes.mouth);  // (mouth clips are made above, once per character)
  const propsToDraw = undrawn.size;
  const posesToDraw = posesUndrawn.size;
  const poseCost = (posesToDraw + propsToDraw) * kit.edit.price + (sceneToPaint ? kit.scene.price : 0) + mouthsToMake.size * (kit.mouth?.price ?? 0);
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
          ? { image_url: dataUri(shot.start, 'image/jpeg'), audio_url: dataUri(shot.audio, 'audio/mpeg'), prompt: shot.instruction }
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
  const quiet = [];
  const hits = [];
  let t = 0;
  for (const shot of shots) {
    const clip = path.join(out, `clip-${String(shots.indexOf(shot) + 1).padStart(2, '0')}.mp4`);
    if (shot.notes.mouth) {
      // A slice of the character's mouth clip (somewhere new each time, the
      // same place every run), its sound through the ASMR close-mic treatment.
      if (existsSync(shot.mouthClip)) {
        const from = Math.max(0, duration(shot.mouthClip) - shot.seconds - 0.1) * seeded(`${slug}-mouth-${shots.indexOf(shot)}`)();
        mouthInsert({ clip: shot.mouthClip, from, seconds: shot.seconds, chain: kit.mouth.chain, volume: kit.mouth.volume, size, fps, outFile: clip });
      } else {
        const still = mouthStillPath(HERE, shot.who, mouthSettings(shot.who));
        stillClip({ frame: existsSync(still) ? still : plate, audio: null, seconds: shot.seconds, size, fps, outFile: clip });
      }
      clips.push(clip);
      t += duration(clip);
      continue;
    }
    const video = !shot.notes.still && !shot.notes.off && existsSync(shot.video) ? shot.video : null;
    const keepSound = Boolean(video) && shot.notes.sound && shot.kind === 'action' && hasSound(video);
    composite({
      plate, video, still: video ? null : shot.layer, key: shot.key, camera: shot.notes.camera, focus: shot.focus, base: shot.base,
      jitter: shot.jitter ?? 0, jolts: shot.jolts ?? [], pan: shot.pan ?? 0, mask: shot.notes.mask ?? null,
      audio: shot.audio ?? null, keepSound, seconds: shot.seconds, size, fps, outFile: clip,
    });
    // A wet shot gets the saliva sounds of their mouth close-up under it
    // (quieter under a line, wetUnderVoice, so the words stay clear), unless
    // the whole episode has a saliva bed: then that's there all along.
    if (isWet(shot) && !saliva.length) {
      const id = wetOf(shot);
      const source = mouthClipPath(HERE, id, mouthSettings(id));
      if (existsSync(source) && hasSound(source)) {
        const from = Math.max(0, duration(source) - shot.seconds - 0.1) * seeded(`${slug}-wet-${shots.indexOf(shot)}`)();
        const file = cached(`wet-${hash({ source: hashFile(source), from, seconds: shot.seconds, chain: kit.mouth.chain })}.wav`);
        if (!existsSync(file)) {
          const fade = Math.min(0.15, shot.seconds / 4);
          ffmpeg(['-ss', from.toFixed(3), '-t', shot.seconds.toFixed(3), '-i', source, '-vn', '-af',
            `aresample=48000,aformat=channel_layouts=stereo,${kit.mouth.chain},afade=t=in:d=${fade},afade=t=out:st=${(shot.seconds - fade).toFixed(3)}:d=${fade}`, '-c:a', 'pcm_s16le', file]);
        }
        hits.push({ file, at: t, volume: shot.kind === 'talk' ? kit.mouth.wetUnderVoice ?? 0.6 : kit.mouth.wetVolume ?? 1 });
      }
    }
    // A sound hit for every slam, shake and snap to a close-up.
    for (const [move, name, early] of [['punch', 'hit', 0], ['shake', 'rattle', 0.02], ['close', 'whoosh', 0.12]]) {
      if (shot.notes.camera.includes(move) && kit.hits.sounds[name]) hits.push({ name, at: Math.max(0, t - early), volume: kit.hits.volume });
    }
    const length = duration(clip);
    // Where nobody's talking, static can cut in without drowning a word.
    const quietFrom = shot.kind === 'talk' ? duration(shot.audio) : shot.notes.sound ? length : 0;
    if (length - quietFrom > 0.12) quiet.push([t + quietFrom + 0.03, t + length]);
    if (shot.kind === 'talk') lines.push({ start: t + 0.05, end: t + length - 0.1, who: shot.character.name, text: shot.text.replace(/\[[^\]]*\]\s*/g, '') });
    clips.push(clip);
    t += length;
  }
  let endcard = null;
  if ((settings.endcard ?? 'on') !== 'off' && kit.endcard) {
    const card = path.join(out, 'clip-end.mp4');
    stillClip({ frame: plate, audio: null, seconds: kit.endcard.seconds, size, fps, outFile: card });
    endcard = { start: t, end: t + kit.endcard.seconds, title: kit.endcard.title, line: kit.endcard.line };
    quiet.push([t, t + 0.6]);
    clips.push(card);
    t += duration(card);
  }
  const joined = path.join(out, 'joined.mp4');
  join(clips, path.join(out, 'clips.txt'), joined);
  const captions = settings.captions ?? kit.captions;
  const ass = path.join(out, 'captions.ass');
  writeFileSync(ass, captionsAss({ size, lines: captions !== 'off' ? lines : [], names: captions === 'names', show: kit.show, title: settings.title, endcard }));
  writeFileSync(path.join(out, `${slug}.srt`), captionsSrt(lines));
  const allMade = shots.every(made) && !posesToDraw && !propsToDraw && !sceneToPaint;
  const final = path.join(out, `${slug}${allMade ? '' : '-preview'}.mp4`);
  const vhs = (settings.vhs ?? 'on') !== 'off' && kit.vhs ? { bursts: staticBursts(quiet, kit.vhs, slug), volume: kit.vhs.volume } : null;
  if (vhs) say(`(static: ${vhs.bursts.map(([a, b]) => `${a.toFixed(1)}s`).join(", ")})`);
  // The hit sounds, made once each (a cent or so) and kept in shorts/sounds/.
  const hitFiles = {};
  for (const name of new Set(hits.filter((h) => h.name).map((h) => h.name))) {
    const where = { here: HERE, name: `hit-${name}`, description: kit.hits.sounds[name], seconds: kit.hits.seconds, settings: kit.sounds, say };
    hitFiles[name] = existsSync(soundPath(where)) ? soundPath(where) : opts.offline ? null : await sound(where);
  }
  for (const [name, file] of Object.entries(hitFiles)) if (file) hitFiles[name] = level({ inFile: file, loudness: kit.hits.loudness, outFile: cached(`hit-${hash({ file: hashFile(file), loudness: kit.hits.loudness })}.mp3`) });
  const placed = hits.filter((h) => h.file || hitFiles[h.name]).map((h) => ({ ...h, file: h.file ?? hitFiles[h.name] }));
  // The saliva bed (saliva: shiv), start to finish at one level: salivaBelow
  // dB under the dialogue, laid on after the final squeeze so the pauses
  // can't lift it.
  const salivaClips = saliva.map((id) => mouthClipPath(HERE, id, mouthSettings(id))).filter((f) => existsSync(f));
  const bed = salivaClips.length ? salivaBed({ clips: salivaClips, seconds: t, seed: `${slug}-saliva`, chain: kit.mouth.chain, cacheDir: CACHE }) : null;
  const salivaLoudness = MASTER_LOUDNESS - (kit.mouth.salivaBelow ?? 9);
  const over = bed ? { file: level({ inFile: bed, loudness: salivaLoudness, outFile: cached(`saliva-${hash({ bed: hashFile(bed), loudness: salivaLoudness })}.mp3`) }) } : null;
  if (!bed && saliva.length) say(`(no saliva bed: ${saliva.join(', ')} ${saliva.length > 1 ? "have" : "has"} no mouth close-up with sound yet)`);
  const musicUntil = kit.music.until === 'first line' && lines.length ? lines[0].start : null;
  const range = kit.voice.asmr && (settings.asmr ?? 'on') !== 'off' ? kit.voice.asmr.range : 11;  // (loudness range: ASMR is squeezed tight)
  finish({ joined, ass, fontsDir: path.join(HERE, 'fonts'), music, musicVolume: kit.music.volume, musicUntil, room, sounds, hits: placed, ambience, vhs, over, size, range, total: t, outFile: final });
  for (const clip of [...clips, joined]) rmSync(clip, { force: true });

  say(`\n${allMade ? 'Done' : 'Preview (stills where the video shots will go)'}: ${path.relative(ROOT, final)} (${t.toFixed(1)}s)`);
  if (failed.length && broke) say('No video shots were made: top up fal, then run this again with --yes (the voices are already made).');
  else if (failed.length) say(`${failed.length} shot${failed.length > 1 ? 's' : ''} failed (${failed.map((s) => s.label).join(', ')}): they're stills for now. Run again with --yes to retry them.`);
  const left = shots.filter((s) => !made(s) && !s.notes.mouth);
  if ((left.length || posesToDraw || propsToDraw || sceneToPaint || mouthsToMake.size) && !opts.yes) {
    const parts = [left.length && `${left.length} video shot${left.length > 1 ? 's' : ''}`, posesToDraw && `${posesToDraw} turned pose${posesToDraw > 1 ? 's' : ''}`, mouthsToMake.size && `${mouthsToMake.size} mouth close-up${mouthsToMake.size > 1 ? 's' : ''}`, propsToDraw && 'the props', sceneToPaint && 'the scene'].filter(Boolean);
    say(`To make the ${parts.join(' and ')} (about ${money(left.reduce((sum, s) => sum + s.price, 0) + poseCost)} on fal), run it again with --yes.`);
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
