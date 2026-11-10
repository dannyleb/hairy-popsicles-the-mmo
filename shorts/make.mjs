#!/usr/bin/env node
// Script in, short out. From the repo root:
//
//   npm run short -- shorts/scripts/lost-eye.txt          voices, a preview cut, and what the video would cost
//   npm run short -- shorts/scripts/lost-eye.txt --yes    ...and the real thing (pays for the video shots)
//   npm run short -- shorts/scripts/lost-eye.txt --yes --redo 3,5    new takes of shots 3 and 5
//   npm run short -- shorts/scripts/lost-eye.txt --revoice 2         say line 2 again
//   npm run short -- shorts/scripts/lost-eye.txt --offline           no services at all (placeholder voices)
//   npm run short -- --voices                                        the ElevenLabs voices on your account
//
// Everything made is kept (shorts/out/.cache), keyed by what went into it,
// so running again only makes what changed: edit one line and only that
// line's voice and shot are made again.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captionsAss, captionsSrt } from './lib/captions.mjs';
import { duration, ffmpeg, finish, fitClip, hasSound, hash, hashFile, join, startFrame, stillClip } from './lib/media.mjs';
import { parseScript } from './lib/script.mjs';
import { changeVoice, dataUri, falVideo, findVoice, listVoices, loadKeys, speak } from './lib/services.mjs';

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
const TAIL = 0.3;              // s of quiet after each line, before the cut
const WORDS_PER_SECOND = 2.6;  // for placeholder voices (--offline)

const kit = JSON.parse(readFileSync(path.join(HERE, 'kit.json'), 'utf8'));
const cast = JSON.parse(readFileSync(path.join(HERE, 'cast.json'), 'utf8'));
const say = (...parts) => console.log(...parts);
const money = (n) => `$${n.toFixed(2)}`;

function args(argv) {
  const opts = { script: null, yes: false, offline: false, voices: false, redo: new Set(), revoice: new Set() };
  const shots = (v) => new Set(String(v ?? '').split(',').map(Number).filter((n) => n > 0));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--offline') opts.offline = true;
    else if (a === '--voices') opts.voices = true;
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

async function main() {
  const opts = args(process.argv.slice(2));
  loadKeys(HERE);
  if (opts.voices) {
    for (const v of await listVoices()) say(`${v.name.padEnd(48)} ${v.category ?? ''}`);
    return;
  }
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
  const { fps } = kit;
  const background = backgroundImage(settings.background ?? kit.background);
  const music = settings.music && settings.music !== 'none' ? locate(settings.music) : null;
  if (settings.music && settings.music !== 'none' && !music) throw new Error(`The music (${settings.music}) isn't there. Put it in shorts/music/.`);
  const cached = (name) => path.join(CACHE, name);

  // ---- voices
  let voices = [];
  if (!opts.offline && shots.some((s) => s.kind === 'talk')) voices = await listVoices();
  say(`\n${settings.title ?? slug}: ${shots.length} shots, ${format}${opts.offline ? ' (offline)' : ''}\n`);
  for (const shot of shots) {
    shot.character = shot.who === 'scene' ? null : cast[shot.who];
    shot.label = `#${shots.indexOf(shot) + 1} ${shot.character ? shot.character.name : 'Scene'}`;
    const image = shot.character ? characterImage(shot.who) : null;
    if (image && !existsSync(image)) throw new Error(`No picture of ${shot.character.name} (${image}).`);
    const framing = kit.framing[shot.kind === 'talk' ? 'talking' : 'action'];
    const frameKey = hash({ image: image && hashFile(image), background: background && hashFile(background), size, framing });
    shot.frame = cached(`frame-${frameKey}.jpg`);
    shot.frameKey = frameKey;
    if (!existsSync(shot.frame)) startFrame({ character: image, background, size, ...framing, outFile: shot.frame });
    if (shot.kind !== 'talk') {
      shot.seconds = shot.notes.seconds ?? kit.action.seconds;
      continue;
    }
    const direction = shot.notes.direction.join(', ');
    const take = shot.notes.take && locate(shot.notes.take);
    if (shot.notes.take && !take) throw new Error(`${shot.label}: the take ${shot.notes.take} isn't there (put recordings in shorts/takes/).`);
    const voice = opts.offline ? { id: 'offline' } : findVoice(voices, shot.character.voice ?? '');
    if (!voice) throw new Error(`${shot.character.name}'s voice "${shot.character.voice}" isn't on your ElevenLabs account. Pick one from: npm run short -- --voices`);
    const settingsV = shot.character.voiceSettings ?? null;
    const voiceKey = hash({ text: shot.text, direction, tags: direction ? 2 : 0, voice: voice.id, model: take ? kit.voice.changerModel : kit.voice.model, take: take && hashFile(take), settingsV, offline: opts.offline });
    shot.audio = cached(`voice-${voiceKey}.mp3`);
    if (opts.revoice.has(shots.indexOf(shot) + 1)) rmSync(shot.audio, { force: true });
    if (!existsSync(shot.audio)) {
      if (opts.offline) {
        const seconds = Math.max(1.2, shot.text.split(/\s+/).length / WORDS_PER_SECOND);
        ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', seconds.toFixed(2), '-c:a', 'libmp3lame', shot.audio]);
      } else if (take) {
        say(`${shot.label}: turning your take into ${shot.character.name}'s voice...`);
        await changeVoice({ inFile: take, voiceId: voice.id, model: kit.voice.changerModel, format: kit.voice.format, settings: settingsV, outFile: shot.audio });
      } else {
        say(`${shot.label}: ${shot.character.name} says "${shot.text}"${direction ? ` (${direction})` : ''}`);
        await speak({ text: shot.text, direction, voiceId: voice.id, model: kit.voice.model, format: kit.voice.format, settings: settingsV, outFile: shot.audio });
      }
    }
    shot.seconds = Math.max(duration(shot.audio) + TAIL, kit.talking.minSeconds);
  }

  // ---- what each shot's video is, and what's still to make
  const style = kit.style;
  for (const shot of shots) {
    const look = shot.character?.look ?? 'the scene';
    const direction = shot.notes.direction.join(', ');
    const lipsync = shot.kind === 'talk' && shot.character.lipsync !== false;
    if (lipsync) {
      shot.model = kit.talking.model;
      shot.prompt = `${look}, talking${direction ? `, ${direction}` : ''}. ${style}`;
      shot.billed = shot.seconds;
      shot.price = shot.billed * kit.talking.pricePerSecond;
    } else {
      // An action shot, or someone with no mouth to sync talking over one.
      shot.model = kit.action.model;
      const doing = shot.kind === 'talk' ? `talking, moving as it speaks${direction ? `, ${direction}` : ''}` : `${shot.text}${direction ? `, ${direction}` : ''}`;
      shot.prompt = shot.character ? `${look}: ${doing}. ${style}` : `${doing}. ${style}`;
      shot.billed = Math.min(15, Math.max(3, Math.ceil(shot.seconds)));
      shot.price = shot.billed * kit.action.pricePerSecond * (shot.notes.sound ? 1.5 : 1);
    }
    shot.videoKey = hash({ model: shot.model, frame: shot.frameKey, audio: lipsync ? hashFile(shot.audio) : null, prompt: shot.prompt, billed: shot.billed, sound: shot.notes.sound });
    shot.video = cached(`shot-${shot.videoKey}.mp4`);
    if (opts.redo.has(shots.indexOf(shot) + 1)) rmSync(shot.video, { force: true });
    shot.lipsync = lipsync;
  }
  const toMake = shots.filter((s) => !existsSync(s.video));
  const cost = toMake.reduce((sum, s) => sum + s.price, 0);
  say('');
  for (const s of shots) {
    const state = existsSync(s.video) ? 'made' : `to make, about ${money(s.price)}`;
    say(`  ${s.label.padEnd(22)} ${s.kind === 'talk' ? 'talks ' : 'action'} ${s.seconds.toFixed(1).padStart(5)}s  ${state}`);
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
      const input = shot.lipsync
        ? { image_url: dataUri(shot.frame, 'image/jpeg'), audio_url: dataUri(shot.audio, 'audio/mpeg'), prompt: shot.prompt }
        : {
            start_image_url: dataUri(shot.frame, 'image/jpeg'), prompt: shot.prompt, duration: String(shot.billed),
            generate_audio: shot.notes.sound, negative_prompt: kit.action.negative,
          };
      try {
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

  // ---- the cut: video where it's made, the still frame where it isn't yet
  const clips = [];
  const lines = [];
  let t = 0;
  for (const shot of shots) {
    const clip = path.join(out, `clip-${String(shots.indexOf(shot) + 1).padStart(2, '0')}.mp4`);
    if (existsSync(shot.video)) {
      const keepSound = shot.notes.sound && shot.kind === 'action' && hasSound(shot.video);
      fitClip({ video: shot.video, audio: shot.audio ?? null, keepSound, seconds: shot.seconds, size, fps, outFile: clip });
    } else {
      stillClip({ frame: shot.frame, audio: shot.audio ?? null, seconds: shot.seconds, size, fps, outFile: clip });
    }
    const length = duration(clip);
    if (shot.kind === 'talk') lines.push({ start: t + 0.05, end: t + length - 0.1, who: shot.character.name, text: shot.text });
    clips.push(clip);
    t += length;
  }
  const endcardOn = (settings.endcard ?? 'on') !== 'off' && kit.endcard;
  let endcard = null;
  if (endcardOn) {
    const card = path.join(out, 'clip-end.mp4');
    const frame = cached(`frame-${hash({ background: background && hashFile(background), size, end: true })}.jpg`);
    if (!existsSync(frame)) startFrame({ character: null, background, size, outFile: frame });
    stillClip({ frame, audio: null, seconds: kit.endcard.seconds, size, fps, outFile: card });
    endcard = { start: t, end: t + kit.endcard.seconds, title: kit.endcard.title, line: kit.endcard.line };
    clips.push(card);
    t += duration(card);
  }
  const joined = path.join(out, 'joined.mp4');
  join(clips, path.join(out, 'clips.txt'), joined);
  const captionsOn = (settings.captions ?? kit.captions) !== 'off';
  const ass = path.join(out, 'captions.ass');
  writeFileSync(ass, captionsAss({ size, lines: captionsOn ? lines : [], names: (settings.captions ?? kit.captions) === 'names', title: settings.title, endcard }));
  writeFileSync(path.join(out, `${slug}.srt`), captionsSrt(lines));
  const allMade = shots.every((s) => existsSync(s.video));
  const final = path.join(out, `${slug}${allMade ? '' : '-preview'}.mp4`);
  finish({ joined, ass, fontsDir: path.join(HERE, 'fonts'), music, musicVolume: kit.music.volume, total: t, outFile: final });
  for (const clip of [...clips, joined]) rmSync(clip, { force: true });

  say(`\n${allMade ? 'Done' : 'Preview (stills where the video shots will go)'}: ${path.relative(ROOT, final)} (${t.toFixed(1)}s)`);
  if (failed.length && broke) say('No video shots were made: top up fal, then run this again with --yes (the voices are already made).');
  else if (failed.length) say(`${failed.length} shot${failed.length > 1 ? 's' : ''} failed (${failed.map((s) => s.label).join(', ')}): they're stills for now. Run again with --yes to retry them.`);
  const left = shots.filter((s) => !existsSync(s.video));
  if (left.length && !opts.yes) say(`To make the ${left.length} video shot${left.length > 1 ? 's' : ''} (about ${money(left.reduce((sum, s) => sum + s.price, 0))} on fal), run it again with --yes.`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
