import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
export function whole(outFile, make) {
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
// A texture (the game's ground) is blurred and darkened hard so it reads as a
// backdrop; a painted `scene` only a little (some depth of field), to keep it a place.
export function startFrame({ character, background, scene = false, size: [W, H], height, bottom, outFile }) {
  const inputs = background ? ['-i', background] : ['-f', 'lavfi', '-i', `color=c=0x0e0608:s=${W}x${H}`];
  const treat = scene ? 'gblur=sigma=1.6,eq=brightness=-0.05:saturation=0.95,vignette=PI/5' : 'gblur=sigma=4,eq=brightness=-0.1:saturation=0.85,vignette=PI/4';
  const bg = background
    ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${treat}[bg]`
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
// file; the voices in the room (`room`: { response, level }) with the sound
// `hits` ([{ file, at, volume }]); the episode's `sounds` ({ file, volume })
// and/or a made-up `ambience` under them; music under the title until
// `musicUntil`; VHS static; the sound brought to the loudness the apps expect.
export function finish({ joined, ass, fontsDir, music, musicVolume = 0.4, musicUntil = null, room = null, sounds = null, hits = [], ambience, vhs, size: [W, H] = [1080, 1920], total, outFile }) {
  const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const subs = ass ? `subtitles='${esc(ass)}':fontsdir='${esc(fontsDir)}'` : 'null';
  const glitch = vhs?.bursts.length ? staticBursts(vhs.bursts) : null;
  const fadeAt = Math.max(0, total - 1.8).toFixed(2);
  const inputs = ['-i', joined];
  let count = 1;
  const input = (...args) => {
    inputs.push(...args);
    return count++;
  };
  const graph = [];
  const stereo = 'aresample=48000,aformat=channel_layouts=stereo';

  // The voices (and the sound hits) ring in the scene's room: a little duller
  // and squeezed together, then their echo off its walls.
  graph.push(`[0:a]${stereo},asplit[voices][key]`, '[voices]highpass=f=80,lowpass=f=11000,acompressor=threshold=0.125:ratio=2.5:attack=8:release=150[dry0]');
  let bus = '[dry0]';
  if (hits.length) {
    hits.forEach((h, i) => {
      const k = input('-i', h.file);
      const ms = Math.max(0, Math.round(h.at * 1000));
      graph.push(`[${k}:a]${stereo},volume=${h.volume},adelay=${ms}|${ms}[hit${i}]`);
    });
    graph.push(`${bus}${hits.map((_, i) => `[hit${i}]`).join('')}amix=inputs=${hits.length + 1}:duration=first:normalize=0[withhits]`);
    bus = '[withhits]';
  }
  if (room) {
    const k = input('-i', room.response);
    graph.push(`${bus}asplit[direct][send]`, `[send][${k}:a]afir=gtype=gn:irgain=1[echo0]`, `[echo0]volume=${room.level}[echo]`,
      '[direct][echo]amix=inputs=2:duration=first:normalize=0[inroom]');
    bus = '[inroom]';
  }
  const mix = [bus];

  // The environment under everything: the episode's own sounds and/or a
  // made-up bed, dipping a little under the voices but always there.
  const beds = [];
  if (sounds) {
    const k = input('-stream_loop', '-1', '-i', sounds.file);
    beds.push(`[${k}:a]${stereo},volume=${sounds.volume},afade=t=in:d=1.2,afade=t=out:st=${fadeAt}:d=1.8`);
  }
  if (ambience) {
    const k = input('-f', 'lavfi', '-i', ambience);
    beds.push(`[${k}:a]${stereo},afade=t=in:d=1.5,afade=t=out:st=${fadeAt}:d=1.8`);
  }
  if (beds.length) {
    beds.forEach((b, i) => graph.push(`${b}[bed${i}]`));
    graph.push(beds.length > 1 ? `${beds.map((_, i) => `[bed${i}]`).join('')}amix=inputs=${beds.length}:normalize=0[beds]` : '[bed0]anull[beds]');
    graph.push('[beds][key]sidechaincompress=threshold=0.02:ratio=3:attack=40:release=600:makeup=1[under]');
    mix.push('[under]');
  } else {
    graph.push('[key]anullsink');
  }

  // Music under the title only: it fades away as the first line is said
  // (or, with no lines, plays to the end).
  if (music) {
    const k = input('-stream_loop', '-1', '-i', music);
    const out = musicUntil != null ? `afade=t=out:st=${Math.max(0.5, musicUntil - 0.2).toFixed(2)}:d=1.8,atrim=0:${(musicUntil + 1.7).toFixed(2)}` : `afade=t=out:st=${fadeAt}:d=1.8`;
    graph.push(`[${k}:a]${stereo},volume=${musicVolume},afade=t=in:d=0.6,${out}[music]`);
    mix.push('[music]');
  }

  let video = `[0:v]${subs}[v]`;
  if (glitch) {
    const band = input('-f', 'lavfi', '-i', `color=c=black:s=${W}x${Math.round(H * 0.035)}:r=30`);
    const noise = input('-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.7:sample_rate=48000');
    const buzz = input('-f', 'lavfi', '-i', "aevalsrc='0.25*sgn(sin(2*PI*119*t))+0.12*sgn(sin(2*PI*61*t))':s=48000");
    video = `[0:v]${subs},${glitch.picture}[g];`
      // the tracking band: bright streaks of noise rolling down the picture
      + `[${band}:v]noise=alls=100:allf=t+u,avgblur=sizeX=28:sizeY=1,eq=contrast=2.2:brightness=0.15,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='min(255,1.8*r(X,Y))'[bandraw];`
      + `[g][bandraw]overlay=x=0:y='mod(t*1700,main_h)-overlay_h':enable='${glitch.on}':eval=frame:shortest=0[v]`;
    graph.push(`[${noise}:a]highpass=f=900,lowpass=f=7500,acrusher=bits=6:mix=0.5[n]`, `[${buzz}:a]lowpass=f=1800[z]`,
      `[n][z]amix=inputs=2:normalize=0,volume='if(${glitch.on},${vhs.volume ?? 0.3},0)':eval=frame,${stereo}[hiss]`);
    mix.push('[hiss]');
  }
  graph.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`);
  ffmpeg([
    ...inputs, '-filter_complex', `${video};${graph.join(';')}`, '-map', '[v]', '-map', '[a]',
    '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    ...AUDIO, '-movflags', '+faststart', outFile,
  ]);
}

// VHS static over the picture during each burst ([start, end] seconds):
// grain, the colours sliding apart, a flicker and a rolling tracking band.
function staticBursts(bursts) {
  const on = bursts.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+');
  const wobble = '(14*sin(Y*0.045+T*70)+5*sin(Y*0.37+T*17))';  // lines sliding sideways
  const picture = [
    `geq=lum='lum(X+${wobble},Y)':cb='cb(X+${wobble}/2,Y)':cr='cr(X+${wobble}/2,Y)':enable='${on}'`,
    `noise=alls=80:allf=t+u:enable='${on}'`,
    `rgbashift=rh=-14:bh=12:gv=3:edge=wrap:enable='${on}'`,
    `eq=brightness=0.07:contrast=1.25:saturation=0.6:enable='${on}'`,
    `boxblur=luma_radius=2:luma_power=1:chroma_radius=10:enable='${on}'`,
  ].join(',');
  return { on, picture };
}

// A sound brought to a set loudness (LUFS), kept as a file: sound effects
// come out of the model at all sorts of levels.
export function level({ inFile, loudness, outFile }) {
  if (existsSync(outFile)) return outFile;
  whole(outFile, (temp) => ffmpeg(['-i', inFile, '-af', `loudnorm=I=${loudness}:TP=-2:LRA=20`, '-ar', '48000', '-c:a', 'libmp3lame', '-q:a', '2', '-f', 'mp3', temp]));
  return outFile;
}

// A music track given a treatment once (kit.json music.tracks: slowed,
// detuned and drowned in echo for the creepy versions), kept as a file.
export function treatMusic({ inFile, fx, outFile }) {
  whole(outFile, (temp) => ffmpeg(['-i', inFile, '-af', fx ? `${fx},loudnorm=I=-20:TP=-2` : 'loudnorm=I=-20:TP=-2', '-ar', '48000', '-c:a', 'libmp3lame', '-q:a', '2', '-f', 'mp3', temp]));
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

// ---------- layers: characters over a still background ----------

export const KEYS = { green: { hex: '0x00FF00', css: 'pure green (#00FF00)', despill: 'green' }, blue: { hex: '0x0000FF', css: 'pure blue (#0000FF)', despill: 'blue' } };

// The characters on a transparent frame, each fitted in its box: { image,
// cx (centre, px), bottom (px), width, height (the box, px) }.
export function layer({ chars, size: [W, H], outFile }) {
  const inputs = ['-f', 'lavfi', '-i', `color=c=black@0.0:s=${W}x${H},format=rgba`, ...chars.flatMap((c) => ['-i', c.image])];
  const steps = ['[0:v]null[l]'];  // (an empty layer when there's no one in it)
  let last = '[l]';
  chars.forEach((c, i) => {
    steps.push(`[${i + 1}:v]format=rgba,scale=${Math.round(c.width)}:${Math.round(c.height)}:force_original_aspect_ratio=decrease[c${i}]`);
    steps.push(`${last}[c${i}]overlay=x=${Math.round(c.cx)}-w/2:y=${Math.round(c.bottom)}-h:format=auto[l${i}]`);
    last = `[l${i}]`;
  });
  whole(outFile, (temp) => ffmpeg([...inputs, '-filter_complex', steps.join(';'), '-map', last, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', temp]));
}

// A character layer on a flat key colour: the first frame for a video model,
// whose background is then keyed out again.
export function onKey({ layerFile, key, size: [W, H], outFile }) {
  whole(outFile, (temp) => ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${KEYS[key].hex}:s=${W}x${H}`, '-i', layerFile,
    '-filter_complex', '[0:v][1:v]overlay=format=auto,format=yuvj420p', '-frames:v', '1', '-q:v', '2', '-f', 'image2', temp,
  ]));
}

// The finished shot: the still background, the character layer over it
// (keyed out of a video, or a still layer) with its shadow on the floor,
// moved by the camera notes (on the character only, the background stays
// put), `seconds` long. `focus`: [x, y] the camera moves about (the face).
// `base`: how far down the frame they touch the floor (null: no shadow).
// The shadow is their own outline flattened onto the floor at `base`, so it
// follows every move they make, and moves with them under the camera notes.
//
// The frenzy: `jitter` (pixels) keeps the camera trembling like it's
// handheld by someone who hasn't slept, and `jolts` ([[seconds, size]])
// snap it in and let it spring back. `pan` (-1 left to 1 right) puts the
// voice where they stand.
export function composite({ plate, video, still, key = 'green', camera = [], focus: [fx, fy], base = null, jitter = 0, jolts = [], pan = 0, audio, keepSound, seconds, size: [W, H], fps, outFile }) {
  const D = seconds.toFixed(3);
  const spring = (at) => `exp(-(t-${at.toFixed(3)})/0.13)*gte(t,${at.toFixed(3)})`;
  const zoom = [
    camera.includes('close') ? '1.7' : '1',
    camera.includes('punch') ? '(1+0.22*min(t/0.12,1))' : '1',
    camera.includes('push') ? `(1+0.12*t/${D})` : '1',
    jolts.length ? `(1+${jolts.map(([at, size]) => `${size.toFixed(3)}*${spring(at)}`).join('+')})` : '1',
  ].join('*');
  const shake = camera.includes('shake');
  const tremble = jitter ? `+${jitter}*(sin(t*9.1)+0.7*sin(t*23.3+1.1)+0.4*sin(t*41.7+2.3))` : '';
  const kick = jolts.map(([at, size], i) => `${((i % 2 ? -1 : 1) * size * 260).toFixed(1)}*${spring(at)}`).join('+');
  const dx = `${shake ? '+16*sin(t*53)+9*sin(t*31)' : ''}${tremble}${kick ? `+${kick}` : ''}`;
  const dy = `${shake ? '+12*sin(t*47)+7*sin(t*23)' : ''}${jitter ? `+${jitter}*(0.8*sin(t*7.3+0.5)+0.6*sin(t*19.7))` : ''}`;
  const moved = zoom === '1*1*1*1' && !dx && !dy;
  const source = video
    ? `[1:v]scale=${W}:${H},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=5,chromakey=${KEYS[key].hex}:0.28:0.06,despill=type=${KEYS[key].despill},format=rgba`
    : `[1:v]fps=${fps},format=rgba`;
  const motion = moved ? '' : `,scale=w='trunc(${W}*${zoom}/2)*2':h='trunc(${H}*${zoom}/2)*2':eval=frame`;
  const x = moved ? '0' : `'${fx}-${fx}*${zoom}${dx}'`;
  const y = moved ? '0' : `'${fy}-${fy}*${zoom}${dy}'`;
  // A shadow: the outline squashed to `flat` of its height, laid on the floor
  // with its bottom `drop` below where they touch it.
  const flatten = (label, flat, drop, alpha, blur) => {
    const h = Math.max(2, Math.round(H * flat));
    const top = Math.max(0, Math.min(H - h, Math.round(base * (1 - flat) + H * drop)));
    return `[${label}]colorchannelmixer=rr=0:gg=0:bb=0:aa=${alpha},scale=${W}:${h},pad=${W}:${H}:0:${top}:color=black@0,gblur=sigma=${blur}`;
  };
  const graph = [`[0:v]fps=${fps},scale=${W}:${H},setsar=1,format=rgba[bg]`];
  if (base == null) {
    graph.push(`${source}[actor]`);
  } else {
    graph.push(
      `${source},split=3[fg][s1][s2]`,
      `${flatten('s1', 0.07, 0, 0.72, 6)}[core]`,   // dark, right under them
      `${flatten('s2', 0.13, 0.012, 0.3, 26)}[soft]`,    // a faint spread round it
      '[soft][core]overlay=format=auto[shadow]',
      '[shadow][fg]overlay=format=auto[actor]',
    );
  }
  graph.push(`[actor]format=rgba${motion}[moved]`, `[bg][moved]overlay=x=${x}:y=${y}:eval=frame,format=yuv420p[v]`);
  const inputs = ['-loop', '1', '-framerate', String(fps), '-i', plate, ...(video ? ['-i', video] : ['-loop', '1', '-framerate', String(fps), '-i', still])];
  let a;
  if (keepSound) {
    a = '[1:a]aresample=48000,apad[a]';
  } else if (audio) {
    inputs.push('-i', audio);
    const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;  // equal loudness wherever they stand
    a = `[2:a]aresample=48000,aformat=channel_layouts=mono,pan=stereo|c0=${Math.cos(angle).toFixed(3)}*c0|c1=${Math.sin(angle).toFixed(3)}*c0,apad[a]`;
  } else {
    inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    a = '[2:a]anull[a]';
  }
  ffmpeg([...inputs, '-filter_complex', `${graph.join(';')};${a}`, '-map', '[v]', '-map', '[a]', '-t', D,
    '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', outFile]);
}

// An image's [width, height].
export function imageSize(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return probe.stdout.trim().split(',').map(Number);
}

// The bounding box of what isn't transparent in an image: [x, y, w, h].
export function opaqueBox(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = probe.stdout.trim().split(',').map(Number);
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 256 * 1024 * 1024 }).stdout;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (raw[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? [0, 0, w, h] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

// A picture on a flat key colour, keyed to transparent and cropped to what's left.
export function keyOut({ inFile, key, outFile }) {
  const keyed = `${outFile}.keyed.png`;
  ffmpeg(['-i', inFile, '-vf', `chromakey=${KEYS[key].hex}:0.28:0.06,despill=type=${KEYS[key].despill},format=rgba`, '-frames:v', '1', keyed]);
  const [x, y, w, h] = opaqueBox(keyed);
  whole(outFile, (temp) => ffmpeg(['-i', keyed, '-vf', `crop=${w}:${h}:${x}:${y}`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '92', '-f', 'webp', temp]));
  rmSync(keyed, { force: true });
}
