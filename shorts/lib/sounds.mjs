import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ffmpeg, hash, whole } from './media.mjs';
import { download, falRun } from './services.mjs';

// The sound around the characters: the episode's own environment (a loop
// made from its script's `sounds:` line), a few short sound hits for the
// camera's punches and shakes, and the room their voices ring in. Made once
// by a sound-effects model and kept in shorts/sounds/ (committed: they cost
// money, if not much).

const slugOf = (name) => name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

export function soundPath({ here, name, description, seconds, loop, settings }) {
  const key = hash({ description, seconds, loop, model: settings.model });
  return path.join(here, 'sounds', `${slugOf(name)}-${key.slice(0, 8)}.mp3`);
}

// A sound from its description: `seconds` long (0.5 to 22), looping cleanly if `loop`.
export async function sound({ here, name, description, seconds, loop = false, settings, say }) {
  const file = soundPath({ here, name, description, seconds, loop, settings });
  if (existsSync(file)) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  say(`Making the sound: ${description}`);
  const body = await falRun(settings.model, { text: description, duration_seconds: seconds, loop, prompt_influence: settings.influence ?? 0.5 });
  const url = body.audio?.url;
  if (!url) throw new Error(`The sound model didn't make "${description}" (${JSON.stringify(body).slice(0, 200)}).`);
  const raw = `${file}.raw`;
  await download(url, raw);
  whole(file, (temp) => ffmpeg(['-i', raw, '-ar', '48000', '-c:a', 'libmp3lame', '-q:a', '2', '-f', 'mp3', temp]));
  rmSync(raw, { force: true });
  return file;
}

// The rooms a voice can ring in: how long the echo takes to die away
// (seconds), how soon the first reflection comes back, how bright it is, and
// how loud it is under the voice.
export const ROOMS = {
  small: { decay: 0.5, predelay: 0.006, tone: 5200, level: 0.35 },   // a cramped room, an office, a bedroom
  large: { decay: 1.2, predelay: 0.018, tone: 4500, level: 0.32 },   // a parlour, a hall
  cavern: { decay: 2.4, predelay: 0.032, tone: 3000, level: 0.42 },  // wet, deep, inside something
};

// A room's echo as an impulse response: noise dying away exponentially, a
// different noise in each ear so it's wide. Made locally, kept in the cache.
export function roomResponse({ room, outFile }) {
  const r = ROOMS[room];
  if (!r) throw new Error(`room: ${room}? It's ${Object.keys(ROOMS).join(', ')} or none.`);
  if (existsSync(outFile)) return outFile;
  const length = (r.decay * 1.3 + r.predelay).toFixed(3);
  const fall = (6.9 / r.decay).toFixed(4);  // to -60 dB by `decay`
  const ms = Math.round(r.predelay * 1000);
  whole(outFile, (temp) => ffmpeg([
    '-f', 'lavfi', '-i', `anoisesrc=color=white:seed=11:sample_rate=48000:duration=${length}`,
    '-f', 'lavfi', '-i', `anoisesrc=color=white:seed=29:sample_rate=48000:duration=${length}`,
    '-filter_complex', `[0:a][1:a]amerge=inputs=2,aeval='val(0)*exp(-${fall}*t)|val(1)*exp(-${fall}*t)':c=stereo,lowpass=f=${r.tone},highpass=f=180,adelay=${ms}|${ms}`,
    '-c:a', 'pcm_f32le', '-f', 'wav', temp,
  ]));
  return outFile;
}
