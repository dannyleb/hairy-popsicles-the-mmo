import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { duration, ffmpeg, hasSound, hash, hashFile, whole } from './media.mjs';
import { dataUri, download, falRun, falVideo } from './services.mjs';

// ASMR mouth close-ups: now and then, in a pause, the picture cuts to an
// extreme close-up of a character's mouth, the tongue moving, with the sound
// of it. Each character's is made once (kept in shorts/characters/mouths/,
// committed: they cost money): a macro still drawn from their picture by the
// image editor, then a few seconds of it moving, with sound, by the video
// model. Every insert is a short slice of that clip, so later ones are free.

const slug = (settings) => hash({ still: settings.still, clip: settings.clip, seconds: settings.clipSeconds }).slice(0, 8);
export const mouthStillPath = (here, id, settings) => path.join(here, 'characters', 'mouths', `${id}-${slug(settings)}.jpg`);
export const mouthClipPath = (here, id, settings) => path.join(here, 'characters', 'mouths', `${id}-${slug(settings)}.mp4`);

// The still: the character's mouth filling a 9:16 frame.
export async function mouthStill({ here, id, picture, settings, size: [W, H], say }) {
  const file = mouthStillPath(here, id, settings);
  if (existsSync(file)) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  say(`Drawing ${id}'s mouth close-up...`);
  const source = `${file}.source.png`;
  ffmpeg(['-i', picture, '-vf', 'format=rgba,pad=iw+200:ih+200:100:100:color=0x101010ff,format=rgb24', '-frames:v', '1', source]);
  try {
    const body = await falRun(settings.model, { prompt: settings.still, image_urls: [dataUri(source, 'image/png')], aspect_ratio: '9:16' });
    const url = body.images?.[0]?.url;
    if (!url) throw new Error(`The image editor didn't draw ${id}'s mouth.`);
    const drawn = `${file}.drawn.png`;
    await download(url, drawn);
    ffmpeg(['-i', drawn, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, '-frames:v', '1', '-q:v', '2', file]);
    rmSync(drawn, { force: true });
  } finally {
    rmSync(source, { force: true });
  }
  return file;
}

// The clip: the still moving, with its own sound.
export async function mouthClip({ here, id, still, settings, negative, say }) {
  const file = mouthClipPath(here, id, settings);
  if (existsSync(file)) return file;
  say(`Making ${id}'s mouth close-up move (${settings.clipSeconds}s, with sound)...`);
  await falVideo({
    model: settings.video,
    input: { start_image_url: dataUri(still, 'image/jpeg'), prompt: settings.clip, duration: String(settings.clipSeconds), generate_audio: true, negative_prompt: negative },
    outFile: file,
    onStatus: (s) => say(`  ${id}'s mouth: ${s}`),
  });
  return file;
}

// One insert: `seconds` of the clip from `from`, filling the frame, its sound
// given the ASMR close-mic treatment (`chain`), a quick fade at each end.
export function mouthInsert({ clip, from, seconds, chain, volume, size: [W, H], fps, outFile }) {
  const D = seconds.toFixed(3);
  const fade = Math.min(0.12, seconds / 4).toFixed(3);
  const sound = hasSound(clip);
  ffmpeg([
    '-ss', from.toFixed(3), '-t', D, '-i', clip,
    '-filter_complex',
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},format=yuv420p[v];`
    + (sound ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,${chain ? `${chain},` : ''}volume=${volume},afade=t=in:d=${fade},afade=t=out:st=${(seconds - Number(fade)).toFixed(3)}:d=${fade},apad[a]` : 'anullsrc=r=48000:cl=stereo[a]'),
    '-map', '[v]', '-map', '[a]', '-t', D,
    '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', outFile,
  ]);
}

// The part of a clip that has sound in it: from the first moment within
// 20 dB of its loudest to the last (Shiv's close-up is near-silent for its
// first second).
function soundingPart(file) {
  const log = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vn', '-af', 'aresample=48000,asetnsamples=n=4800,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'], { encoding: 'utf8' }).stdout;
  const levels = [...log.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -200 : Number(m[1])));
  const loudest = Math.max(...levels);
  const on = levels.map((l, i) => (l > loudest - 20 ? i : -1)).filter((i) => i >= 0);
  if (!on.length) return { start: 0, length: 0 };
  const start = on[0] * 0.1, end = Math.min((on.at(-1) + 1) * 0.1, duration(file));
  return { start, length: end - start };
}

// A saliva bed: the sound of one or more mouth close-ups under a whole
// episode, at one steady level (script: saliva: shiv). Short slices of the
// clips, picked at random (the same seed, the same bed) and crossfaded into
// each other so it never loops audibly, then the close-mic treatment
// (`chain`), its level held steady (no swells or dips to notice), a fade
// in and a fade out.
export function salivaBed({ clips, seconds, seed, chain, cacheDir }) {
  const sources = clips.filter((c) => hasSound(c)).map((file) => ({ file, ...soundingPart(file) })).filter((c) => c.length > 0.8);
  if (!sources.length) return null;
  const outFile = path.join(cacheDir, `saliva-${hash({ clips: sources.map((c) => hashFile(c.file)), seconds, seed, chain, v: 3 })}.wav`);
  if (existsSync(outFile)) return outFile;
  let n = parseInt(hash(seed).slice(0, 8), 16);
  const random = () => ((n = (n * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const cross = 0.25;
  const slices = [];
  for (let covered = 0; covered < seconds + 1; ) {
    const { file, start, length } = sources[Math.floor(random() * sources.length)];
    const long = Math.min(0.8 + random() * 0.8, length);
    const from = start + random() * (length - long);
    slices.push({ file, from, long });
    covered += long - (slices.length > 1 ? cross : 0);
  }
  const inputs = slices.flatMap((c) => ['-ss', c.from.toFixed(3), '-t', c.long.toFixed(3), '-i', c.file]);
  // (each slice levelled on its own first, so a quiet one doesn't make a dip)
  const graph = slices.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,dynaudnorm=f=100:g=5:p=0.5:m=20[s${i}]`);
  let last = '[s0]';
  for (let i = 1; i < slices.length; i++) {
    graph.push(`${last}[s${i}]acrossfade=d=${cross}:c1=tri:c2=tri[x${i}]`);
    last = `[x${i}]`;
  }
  graph.push(`${last}${chain},dynaudnorm=f=200:g=7:p=0.5:m=15,loudnorm=I=-20:TP=-2:LRA=3,atrim=0:${seconds.toFixed(3)},afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, seconds - 1).toFixed(3)}:d=1[bed]`);
  whole(outFile, (temp) => ffmpeg([...inputs, '-filter_complex', graph.join(';'), '-map', '[bed]', '-c:a', 'pcm_s16le', '-f', 'wav', temp]));
  return outFile;
}
