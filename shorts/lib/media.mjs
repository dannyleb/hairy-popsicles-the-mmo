import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Everything done to pictures and sound, done with ffmpeg.

export function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw new Error(`ffmpeg isn't installed (or isn't on the PATH): ${run.error.message}`);
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr.trim().split('\n').slice(-6).join('\n')}`);
}

// Makes `outFile` under a temporary name and only then moves it into place,
// so a run that fails halfway never leaves a broken file behind (in the
// cache, a broken file would be used again as if it were fine).
function whole(outFile, make) {
  const temp = path.join(path.dirname(outFile), `.part-${path.basename(outFile)}`);
  try {
    make(temp);
    renameSync(temp, outFile);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function duration(file) {
  const run = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const seconds = Number(run.stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`Couldn't read how long ${file} is.`);
  return seconds;
}

export const hash = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex').slice(0, 16);
export const hashFile = (file) => hash(readFileSync(file));

// A shot's first frame: the character standing on the background, with a
// soft shadow. `background` is an image (covering the frame, blurred and
// darkened so the character stands out) or null for plain dark.
export function startFrame({ character, background, size: [W, H], height, bottom, outFile }) {
  const inputs = background ? ['-i', background] : ['-f', 'lavfi', '-i', `color=c=0x0e0608:s=${W}x${H}`];
  const bg = background
    ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=4,eq=brightness=-0.1:saturation=0.85,vignette=PI/4[bg]`
    : '[0:v]vignette=PI/4[bg]';
  if (!character) {
    whole(outFile, (temp) => ffmpeg([...inputs, '-filter_complex', `${bg};[bg]format=yuvj420p`, '-frames:v', '1', '-q:v', '3', '-f', 'image2', temp]));
    return;
  }
  const boxW = Math.round(W * 0.9);
  const boxH = Math.round(H * height);
  const graph = [
    bg,
    `[1:v]format=rgba,scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,split[c][s]`,
    '[s]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.55,gblur=sigma=16[sh]',
    `[bg][sh]overlay=x=(W-w)/2+14:y=${Math.round(H * bottom)}-h+22[b2]`,
    `[b2][c]overlay=x=(W-w)/2:y=${Math.round(H * bottom)}-h,format=yuvj420p`,
  ].join(';');
  whole(outFile, (temp) => ffmpeg([...inputs, '-i', character, '-filter_complex', graph, '-frames:v', '1', '-q:v', '3', '-f', 'image2', temp]));
}

const VIDEO = (fps) => ['-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
const AUDIO = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];
// The shot's sound: its audio padded to length, or silence.
const soundFor = (audio, index) => (audio
  ? { input: ['-i', audio], filter: `[${index}:a]aresample=48000,apad[a]` }
  : { input: ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'], filter: `[${index}:a]anull[a]` });

// A still frame as a clip, slowly pushing in (the preview, before there's video).
export function stillClip({ frame, audio, seconds, size: [W, H], fps, outFile }) {
  const sound = soundFor(audio, 1);
  const zoom = `[0:v]scale=w='trunc(${W}*(1+0.05*t/${seconds.toFixed(3)})/2)*2':h=-2:eval=frame,crop=${W}:${H},setsar=1[v]`;
  ffmpeg([
    '-loop', '1', '-framerate', String(fps), '-i', frame, ...sound.input,
    '-filter_complex', `${zoom};${sound.filter}`, '-map', '[v]', '-map', '[a]',
    '-t', seconds.toFixed(3), ...VIDEO(fps), ...AUDIO, outFile,
  ]);
}

// A clip from a video model, made to fit: the frame size and rate, `seconds`
// long (held on its last frame if it's short), with `audio` as its sound (or
// its own, with `keepSound`, or silence).
export function fitClip({ video, audio, keepSound, seconds, size: [W, H], fps, outFile }) {
  const v = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=5[v]`;
  let inputs = ['-i', video];
  let a;
  if (keepSound) {
    a = '[0:a]aresample=48000,apad[a]';
  } else {
    const sound = soundFor(audio, 1);
    inputs = [...inputs, ...sound.input];
    a = sound.filter;
  }
  ffmpeg([...inputs, '-filter_complex', `${v};${a}`, '-map', '[v]', '-map', '[a]', '-t', seconds.toFixed(3), ...VIDEO(fps), ...AUDIO, outFile]);
}

export function hasSound(file) {
  const run = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return run.stdout.trim().length > 0;
}

// The clips, one after another (they're all the same format, so no re-encode).
export function join(clips, listFile, outFile) {
  writeFileSync(listFile, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'));
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile]);
}

// The finished short: captions (and title, end card) burned in from an .ass
// file, music under everything, and the sound brought to the loudness the
// apps expect.
export function finish({ joined, ass, fontsDir, music, musicVolume, total, outFile }) {
  const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const subs = ass ? `subtitles='${esc(ass)}':fontsdir='${esc(fontsDir)}'` : 'null';
  const inputs = ['-i', joined, ...(music ? ['-stream_loop', '-1', '-i', music] : [])];
  const fadeAt = Math.max(0, total - 1.5).toFixed(2);
  const audio = music
    ? `[1:a]aresample=48000,volume=${musicVolume},afade=t=in:d=0.5,afade=t=out:st=${fadeAt}:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`
    : '[0:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]';
  ffmpeg([
    ...inputs, '-filter_complex', `[0:v]${subs}[v];${audio}`, '-map', '[v]', '-map', '[a]',
    '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    ...AUDIO, '-movflags', '+faststart', outFile,
  ]);
}

// Things done to a voice after it's made, stacked in the order given
// (cast.json: "fx": ["deep", "wet"]). Pitch moves the formants with it, so
// "deep" sounds bigger and "high" smaller, not just slowed or sped up.
export const FX = {
  deep: 'rubberband=pitch=0.8:formant=shifted',
  deeper: 'rubberband=pitch=0.66:formant=shifted',
  high: 'rubberband=pitch=1.25:formant=shifted',
  tiny: 'rubberband=pitch=1.5:formant=shifted',
  warble: 'vibrato=f=5.5:d=0.4',           // wobbling pitch
  tremble: 'tremolo=f=8:d=0.45',           // shaking volume
  gurgle: 'vibrato=f=11:d=0.25,aphaser=type=t:speed=0.6:decay=0.5',
  wet: 'aecho=0.8:0.55:35|62:0.32|0.22,lowpass=f=5000',
  crunch: 'acrusher=bits=6:mode=log:aa=1:mix=0.3',
  rasp: 'highpass=f=180,acompressor=threshold=0.05:ratio=8:attack=5:release=60,acrusher=bits=8:mode=log:aa=1:mix=0.15',
  choir: 'chorus=0.6:0.9:45|60|38:0.45|0.35|0.3:0.3|0.45|0.35:2.1|1.6|2.6',
  echo: 'aecho=0.8:0.75:140|260:0.35|0.22',
  static: 'highpass=f=400,lowpass=f=3200,acrusher=bits=7:mode=lin:aa=1:mix=0.4,tremolo=f=28:d=0.3',
  whisper: 'highpass=f=250,aecho=0.6:0.4:18:0.35',
  uncanny: 'afreqshift=shift=-30,flanger=delay=3:depth=3:speed=0.3',
};

export function applyFx(inFile, outFile, names = []) {
  const unknown = names.filter((n) => !FX[n]);
  if (unknown.length) throw new Error(`No voice effect called ${unknown.join(', ')}. There's: ${Object.keys(FX).join(', ')}.`);
  // Every line at the same loudness, whatever was done to it.
  const chain = [...names.map((n) => FX[n]), 'loudnorm=I=-16:TP=-1.5:LRA=11'].join(',');
  whole(outFile, (temp) => ffmpeg(['-i', inFile, '-af', chain, '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '2', '-f', 'mp3', temp]));
}
