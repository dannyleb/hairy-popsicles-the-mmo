import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ffmpeg, hash } from './media.mjs';
import { download, falRun } from './services.mjs';

// An episode's own environment, painted once from the script's `scene:`
// description by an image model, in the show's style, and kept in
// shorts/backgrounds/ (committed: they cost money to make). It's the still
// background every shot sits on, so changing it never remakes the video.

export function scenePath({ here, slug, description, format, settings }) {
  const key = hash({ description, format, model: settings.model, style: settings.style });
  return path.join(here, 'backgrounds', `${slug}-${key.slice(0, 8)}.jpg`);
}

export async function scene({ here, slug, description, format, size: [W, H], settings, say }) {
  const file = scenePath({ here, slug, description, format, settings });
  if (existsSync(file)) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  say(`Painting the scene: ${description}`);
  const body = await falRun(settings.model, {
    prompt: `${description}. ${settings.style}`,
    aspect_ratio: format === 'wide' ? '16:9' : '9:16',
    resolution: '2K',
    output_format: 'jpeg',
  });
  const url = body.images?.[0]?.url;
  if (!url) throw new Error(`The image model didn't paint the scene (${JSON.stringify(body).slice(0, 200)}).`);
  const raw = `${file}.raw.jpg`;
  await download(url, raw);
  ffmpeg(['-i', raw, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, '-frames:v', '1', '-q:v', '2', file]);
  rmSync(raw, { force: true });
  return file;
}
