import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ffmpeg, hash, hashFile, keyOut, KEYS } from './media.mjs';
import { dataUri, download, falRun } from './services.mjs';

// A character turned to face left or right, so two of them can talk to each
// other. Drawn once by an image editor from the character's own picture, on a
// flat key colour that's keyed out, and kept in shorts/characters/poses/
// (committed: they cost money to make). Facing the camera is their picture as it is.

const prompt = (facing, key) => `Turn this creature's head into a three-quarter view, facing toward the ${facing} side of the picture, as if talking to someone standing just off to the ${facing}. Keep it exactly the same creature: same skin, wrinkles, eyes, teeth, colours, lighting and photoreal 3D render style; nothing added. Plain flat ${KEYS[key].css} background, no shadow, the whole creature in frame.`;

export function posePath(here, id, facing) {
  return path.join(here, 'characters', 'poses', `${id}-${facing}.webp`);
}

// The picture of `id` facing `facing` ('front', 'left' or 'right'), drawn now if it's not been yet.
export async function pose({ here, id, facing, picture, key, model, say }) {
  if (facing === 'front') return picture;
  const file = posePath(here, id, facing);
  if (existsSync(file)) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  say(`Drawing ${id} facing ${facing}...`);
  // The editor gets the picture with some room round it, on black.
  const source = `${file}.source.png`;
  ffmpeg(['-i', picture, '-vf', 'format=rgba,pad=iw+200:ih+200:100:100:color=0x00000000,format=rgb24', '-frames:v', '1', source]);
  try {
    const body = await falRun(model, { prompt: prompt(facing, key), image_urls: [dataUri(source, 'image/png')] });
    const url = body.images?.[0]?.url;
    if (!url) throw new Error(`The image editor didn't return a picture of ${id} facing ${facing}.`);
    const drawn = `${file}.drawn.png`;
    await download(url, drawn);
    keyOut({ inFile: drawn, key, outFile: file });
    rmSync(drawn, { force: true });
  } finally {
    rmSync(source, { force: true });
  }
  return file;
}

// ---------- props ----------

const slugOf = (name) => name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

// A prop on its own, drawn once from its description on a key colour and
// keyed out: kept in shorts/props/.
export const propPath = ({ here, name, description, model }) => path.join(here, 'props', `${slugOf(name)}-${hash({ description, model }).slice(0, 8)}.webp`);

export async function propImage({ here, name, description, style, model, say }) {
  const file = propPath({ here, name, description, model });
  if (existsSync(file)) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  say(`Drawing the ${name}...`);
  const body = await falRun(model, {
    prompt: `A single object on its own: ${description}. ${style} Isolated on a plain flat ${KEYS.green.css} background, no shadow, centred, the whole object in frame.`,
    aspect_ratio: '1:1', resolution: '1K', output_format: 'png',
  });
  const url = body.images?.[0]?.url;
  if (!url) throw new Error(`The image model didn't draw the ${name}.`);
  const drawn = `${file}.drawn.png`;
  await download(url, drawn);
  keyOut({ inFile: drawn, key: 'green', outFile: file });
  rmSync(drawn, { force: true });
  return file;
}

// A character's picture (any facing) with them wearing a prop: drawn once by
// the image editor from their picture, kept beside their poses.
export const wearingPath = ({ here, id, facing, picture, prop, description }) => path.join(here, 'characters', 'poses', `${id}-${facing}-wearing-${slugOf(prop)}-${hash({ description, picture: hashFile(picture) }).slice(0, 8)}.webp`);

export async function wearing({ here, id, facing, picture, prop, description, key, model, say }) {
  const file = wearingPath({ here, id, facing, picture, prop, description });
  if (existsSync(file)) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  say(`Drawing ${id} wearing the ${prop}...`);
  const source = `${file}.source.png`;
  ffmpeg(['-f', 'lavfi', '-i', `color=c=${KEYS[key].hex}:s=1200x1300`, '-i', picture,
    '-filter_complex', '[1:v]scale=1000:1100:force_original_aspect_ratio=decrease[c];[0:v][c]overlay=x=(W-w)/2:y=(H-h)/2,format=rgb24', '-frames:v', '1', source]);
  try {
    const body = await falRun(model, {
      prompt: `Show this exact same creature, at the same angle, now wearing ${description}. Keep the creature identical in every other way: same skin, wrinkles, eyes, teeth, colours, lighting and photoreal 3D render style. Plain flat ${KEYS[key].css} background, no shadow, the whole creature in frame.`,
      image_urls: [dataUri(source, 'image/png')],
    });
    const url = body.images?.[0]?.url;
    if (!url) throw new Error(`The image editor didn't draw ${id} wearing the ${prop}.`);
    const drawn = `${file}.drawn.png`;
    await download(url, drawn);
    keyOut({ inFile: drawn, key, outFile: file });
    rmSync(drawn, { force: true });
  } finally {
    rmSync(source, { force: true });
  }
  return file;
}
