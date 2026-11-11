import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ffmpeg, hasSound, hash } from './media.mjs';
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
