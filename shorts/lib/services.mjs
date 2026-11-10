import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// The two services: ElevenLabs for voices, fal for video. Keys come from
// shorts/.env (ELEVENLABS_API_KEY=..., FAL_KEY=...; never committed) or the
// environment. In a Claude cloud session they're added to each request by the
// network on the way out, so the key here is just a placeholder.
export function loadKeys(dir) {
  const file = path.join(dir, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const elevenKey = () => process.env.ELEVENLABS_API_KEY || 'proxy-injected';
const falKey = () => process.env.FAL_KEY || 'proxy-injected';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- ElevenLabs ----------

const ELEVEN = 'https://api.elevenlabs.io';

async function elevenError(res, what) {
  const body = await res.text();
  if (res.status === 401) return new Error(`ElevenLabs turned the key away (${what}). Check ELEVENLABS_API_KEY. ${body.slice(0, 200)}`);
  if (/quota_exceeded/.test(body)) return new Error(`Out of ElevenLabs characters for this month (${what}). Upgrade the plan or wait for it to reset.`);
  return new Error(`ElevenLabs ${what} failed: ${res.status} ${body.slice(0, 300)}`);
}

export async function listVoices() {
  const res = await fetch(`${ELEVEN}/v1/voices`, { headers: { 'xi-api-key': elevenKey() } });
  if (!res.ok) throw await elevenError(res, 'listing voices');
  return (await res.json()).voices.map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
}

// A voice by id, by its full name, or by the name before its " - description".
export function findVoice(voices, wanted) {
  const w = wanted.trim().toLowerCase();
  return voices.find((v) => v.id === wanted)
    ?? voices.find((v) => v.name.trim().toLowerCase() === w)
    ?? voices.find((v) => v.name.split(' - ')[0].trim().toLowerCase() === w)
    ?? null;
}

// Text to speech, into `outFile` (mp3). Direction goes in as audio tags, one
// short one per note ("[guilty] [mouth full]"), which the v3 model acts on;
// older models just drop it.
export const audioTags = (direction) => direction.split(',').map((t) => t.trim()).filter(Boolean).map((t) => `[${t}]`).join(' ');
export async function speak({ text, direction, voiceId, model, format, settings, outFile }) {
  const tagged = model === 'eleven_v3' && direction ? `${audioTags(direction)} ${text}` : text;
  const body = { text: tagged, model_id: model, ...(settings ? { voice_settings: settings } : {}) };
  const res = await fetch(`${ELEVEN}/v1/text-to-speech/${voiceId}?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': elevenKey(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await elevenError(res, 'text to speech');
  writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));  // (a raw file: make.mjs treats it into the cache)
}

// A recorded take, turned into the character's voice (speech to speech).
export async function changeVoice({ inFile, voiceId, model, format, settings, outFile }) {
  const form = new FormData();
  form.append('audio', new Blob([readFileSync(inFile)]), path.basename(inFile));
  form.append('model_id', model);
  form.append('remove_background_noise', 'true');
  if (settings) form.append('voice_settings', JSON.stringify(settings));
  const res = await fetch(`${ELEVEN}/v1/speech-to-speech/${voiceId}?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': elevenKey(), Accept: 'audio/mpeg' },
    body: form,
  });
  if (!res.ok) throw await elevenError(res, 'voice changer');
  writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

// ---------- fal ----------

const FAL_QUEUE = 'https://queue.fal.run';
const POLL_MS = 4000;
const GIVE_UP_MS = 20 * 60_000;

// Files go to fal inline, as data: URIs.
export const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;

async function falJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Key ${falKey()}`, ...(init.headers ?? {}) } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { res, body };
}

function falError(model, res, body) {
  const detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body).slice(0, 400);
  if (res.status === 401) return new Error(`fal turned the key away (${model}). Check FAL_KEY.`);
  if (res.status === 403 && /balance|credit|billing|locked/i.test(detail)) return new Error(`fal is out of credit: top up at fal.ai/dashboard/billing. (${detail})`);
  return new Error(`fal ${model} failed: ${res.status} ${detail}`);
}

// Runs `model` on `input` through fal's queue (for quick jobs: voices) and
// returns what it made.
export async function falRun(model, input) {
  const { res, body } = await falJson(`${FAL_QUEUE}/${model}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!res.ok || !body.request_id) throw falError(model, res, body);
  const started = Date.now();
  for (;;) {
    const status = await falJson(body.status_url);
    if (status.body.status === 'COMPLETED') break;
    if (Date.now() - started > 5 * 60_000) throw new Error(`fal ${model} took too long.`);
    await sleep(1000);
  }
  const result = await falJson(body.response_url);
  if (!result.res.ok || result.body.detail) throw falError(model, result.res, result.body);
  return result.body;
}

// Downloads in full, then moves into place (see whole() in media.mjs).
export async function download(url, outFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download from ${new URL(url).host} (${res.status}); run again to retry.`);
  const temp = path.join(path.dirname(outFile), `.part-${path.basename(outFile)}`);
  writeFileSync(temp, Buffer.from(await res.arrayBuffer()));
  renameSync(temp, outFile);
}

// ---------- voices on fal (ElevenLabs v3, billed by fal) ----------

// A new voice from a written brief. Returns the saved voice's id and a
// sample of it saying `sample` (100+ characters works best).
export async function falDesignVoice({ model, brief, sample, name }) {
  const body = await falRun(model, { prompt: brief, text: sample, auto_generate_text: false, voice_name: name });
  const preview = body.previews?.find((p) => p.generated_voice_id === body.voice_id) ?? body.previews?.[0];
  if (!body.voice_id || !preview) throw new Error(`fal's voice designer didn't return a voice for ${name}.`);
  return { voiceId: body.voice_id, sampleUrl: preview.audio.url };
}

export async function falSpeak({ model, text, voiceId, stability, outFile }) {
  const body = await falRun(model, { text, voice: voiceId, stability });
  await download(body.audio.url, outFile);
}

export async function falChangeVoice({ model, inFile, voiceId, outFile }) {
  const type = /\.wav$/i.test(inFile) ? 'audio/wav' : /\.m4a$/i.test(inFile) ? 'audio/mp4' : 'audio/mpeg';
  const body = await falRun(model, { audio_url: dataUri(inFile, type), voice: voiceId, remove_background_noise: true });
  await download(body.audio.url, outFile);
}

// Runs `model` on `input` through fal's queue and saves the video it makes to
// `outFile`. The job is noted in `outFile`.pending.json as soon as it's
// submitted, so if this run stops (or the connection drops), the next one
// picks the same job up instead of paying for another.
export async function falVideo({ model, input, outFile, onStatus = () => {} }) {
  const pending = `${outFile}.pending.json`;
  let job = existsSync(pending) ? JSON.parse(readFileSync(pending, 'utf8')) : null;
  if (!job) {
    const { res, body } = await falJson(`${FAL_QUEUE}/${model}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!res.ok || !body.request_id) throw falError(model, res, body);
    job = { model, request_id: body.request_id, status_url: body.status_url, response_url: body.response_url, at: Date.now() };
    writeFileSync(pending, JSON.stringify(job, null, 2));
  }
  onStatus('queued');
  for (let last = ''; ;) {
    const { res, body } = await falJson(job.status_url);
    if (!res.ok && res.status !== 202) throw falError(model, res, body);
    if (body.status !== last) onStatus((last = body.status).toLowerCase().replace('_', ' '));
    if (body.status === 'COMPLETED') break;
    if (Date.now() - job.at > GIVE_UP_MS) throw new Error(`fal ${model} still not done after ${GIVE_UP_MS / 60000} minutes (request ${job.request_id}); run again later to pick it up.`);
    await sleep(POLL_MS);
  }
  const { res, body } = await falJson(job.response_url);
  if (!res.ok || !body.video?.url) {
    rmSync(pending, { force: true });  // a failed job is done with: the next run starts a new one
    throw falError(model, res, body);
  }
  await download(body.video.url, outFile);
  rmSync(pending, { force: true });
  return body;
}
