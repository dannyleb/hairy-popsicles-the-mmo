import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { duration, ffmpeg, hash, hashFile, whole } from './media.mjs';
import { sound, soundPath } from './sounds.mjs';

// The show's voices, ASMR: said softly, right up against a very sensitive
// microphone, so every breath, lip smack, tongue click and wet little pop
// comes through (best in headphones). A whispered take of the line gets
// mouth sounds around and between its words, then the close-mic treatment.

// The mouth sounds, made once by the sound-effects model (kit.voice.asmr.mouth)
// and kept in shorts/sounds/, trimmed of silence and levelled for use.
export async function mouthSounds({ here, cacheDir, asmr, soundSettings, offline, say }) {
  const files = {};
  for (const [name, description] of Object.entries(asmr.mouth)) {
    const where = { here, name: `mouth-${name}`, description, seconds: asmr.mouthSeconds, settings: soundSettings, say };
    const file = existsSync(soundPath(where)) ? soundPath(where) : offline ? null : await sound(where);
    if (!file) continue;
    const ready = path.join(cacheDir, `mouth-${name}-${hash({ file: hashFile(file), v: 1 })}.wav`);
    if (!existsSync(ready)) {
      const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.01';
      whole(ready, (temp) => ffmpeg(['-i', file, '-af', `${trim},areverse,${trim},areverse,aformat=channel_layouts=mono,loudnorm=I=-24:TP=-3`, '-ar', '48000', '-c:a', 'pcm_s16le', '-f', 'wav', temp]));
    }
    files[name] = ready;
  }
  return files;
}

// Where the line goes quiet for a moment ([start, end] seconds), for the
// clicks and smacks between words.
function pauses(file, shortest) {
  const log = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', `silencedetect=noise=-38dB:d=${shortest}`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => [s, ends[i] ?? Infinity]);
}

// `speech` (a whispered take, levelled) made into the ASMR line: an inhale
// and a lip smack before it, a click or a wet pop in its pauses, the lips
// closing after it, and the close-mic sound over all of it. The same seed
// always puts the same sounds in the same places.
export function asmrVoice({ speech, mouth, seed, asmr, outFile }) {
  let n = parseInt(hash(seed).slice(0, 8), 16);
  const random = () => ((n = (n * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = (names) => {
    const have = names.filter((m) => mouth[m]);
    return have.length ? have[Math.floor(random() * have.length)] : null;
  };
  const lead = asmr.lead;
  const length = duration(speech);
  const events = [];  // [mouth sound, at (seconds into the new line)]
  const breath = pick(['inhale']);
  if (breath) events.push([breath, 0]);
  const first = pick(['smack', 'click']);
  if (first) events.push([first, lead - 0.16]);
  for (const [start, end] of pauses(speech, asmr.pause)) {
    if (start < 0.08 || end > length - 0.05) continue;
    const between = pick(['click', 'pop', 'smack', 'saliva']);
    if (between) events.push([between, lead + start + 0.03]);
  }
  const last = pick(['close', 'smack']);
  if (last) events.push([last, lead + length + 0.04]);

  const inputs = ['-i', speech, ...events.flatMap(([name]) => ['-i', mouth[name]])];
  const ms = (s) => Math.max(0, Math.round(s * 1000));
  const parts = [`[0:a]aformat=channel_layouts=mono,aresample=48000,adelay=${ms(lead)},apad=pad_dur=${asmr.tail}[speech]`];
  events.forEach(([, at], i) => parts.push(`[${i + 1}:a]aresample=48000,volume=${asmr.mouthLevel},adelay=${ms(at)}[m${i}]`));
  parts.push(`[speech]${events.map((_, i) => `[m${i}]`).join('')}amix=inputs=${events.length + 1}:duration=first:normalize=0,${asmr.chain}[out]`);
  whole(outFile, (temp) => ffmpeg([...inputs, '-filter_complex', parts.join(';'), '-map', '[out]', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '2', '-f', 'mp3', temp]));
  return outFile;
}
