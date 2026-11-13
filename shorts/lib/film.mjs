import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// A film's cut list (shorts/films/<name>/film.json), read and checked.
//
// {
//   "title": "The Itch", "format": "vertical" | "wide",
//   "look": "words added to every shot's prompt (the look to keep)",
//   "card": { "title": "THE ITCH", "line": "hairypopsicles.com" },
//   "range": 16,                         loudness range of the mix (bigger: quieter quiet, louder loud)
//   "captions": "on" | "off",
//   "sounds": { "<name>": one of
//       { "make": "a description", "seconds": 4 }       made by the sound model, kept in sounds/<name>.mp3
//       { "file": "sounds/ep5-...mp3" }                 a file (in the film's folder, shorts/ or the repo)
//       { "music": "creepy-box" }                       a kit.json music track
//     ...and how loud: "peak": -8 (dB, for a short sound) or "loudness": -30 (LUFS, for a long one) },
//   "beds": [ { "name", "from": "<shot id>", "to": "<shot id>", "volume", "fadeIn", "fadeOut" } ],
//   "shots": [ {
//       "id": "03-nerm", "seconds": 5,
//       "frame": { "paint": "what's in the picture", "with": ["sweats"] }      painted (with those characters in it)
//             or { "set": "backgrounds/....jpg", "who": "redeye", "pose": "characters/poses/x.webp", "height", "bottom", "across" }
//                (how tall they are in the frame, where their foot is, how far across: all 0 to 1)
//       "black": true                    no picture (a pause, a title)
//       "camera": "...", "prompt": "...", "note": "..."     for whoever shoots it
//       "from": 0, "speed": 0.8, "keepSound": true          how the clip (clips/<id>.mp4) is used
//       "still": "push" | "pull" | "hold"                    how the key frame moves while it stands in
//       "fadeIn": 2, "fadeOut": 1, "staticIn": 0.2, "static": true, "card": true,
//       "sound": [ { "name", "at", "volume", "seconds", "fadeIn", "fadeOut" } ],
//       "voice": { "who": "spoon-nana", "say": "Mother's restless.", "how": "wheezing", "at": 1.5, "volume": 1 }
//   } ]
// }

export function readFilm(dir, cast) {
  const file = path.join(dir, 'film.json');
  if (!existsSync(file)) return { film: null, errors: [`There's no film.json in ${dir}.`] };
  let film;
  try {
    film = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { film: null, errors: [`film.json doesn't read as JSON: ${error.message}`] };
  }
  const errors = [];
  const shots = Array.isArray(film.shots) ? film.shots : [];
  if (!shots.length) errors.push('No shots.');
  const ids = new Set();
  const sounds = film.sounds ?? {};
  for (const [name, s] of Object.entries(sounds)) {
    if ([s.make, s.file, s.music].filter(Boolean).length !== 1) errors.push(`Sound "${name}" needs exactly one of make, file or music.`);
    if (s.make && !(s.seconds >= 0.5 && s.seconds <= 22)) errors.push(`Sound "${name}": seconds is 0.5 to 22.`);
  }
  shots.forEach((shot, i) => {
    const label = shot.id ?? `shot ${i + 1}`;
    if (!/^[a-z0-9-]+$/.test(shot.id ?? '')) errors.push(`${label}: an id of small letters, numbers and dashes.`);
    if (ids.has(shot.id)) errors.push(`${label}: that id is used twice.`);
    ids.add(shot.id);
    if (!(shot.seconds > 0)) errors.push(`${label}: how many seconds?`);
    if (!shot.frame && !shot.black) errors.push(`${label}: a frame (paint or set), or black.`);
    if (shot.frame && !shot.frame.paint && !shot.frame.set) errors.push(`${label}: its frame is painted (paint) or put together (set).`);
    for (const id of [...(shot.frame?.with ?? []), ...(shot.frame?.who ? [shot.frame.who] : []), ...(shot.voice ? [shot.voice.who] : [])]) {
      if (!cast[id] || id === '_') errors.push(`${label}: nobody called "${id}" in cast.json (use the id, like "redeye").`);
    }
    if (shot.voice && !shot.voice.say) errors.push(`${label}: its voice says nothing.`);
    for (const cue of shot.sound ?? []) if (!sounds[cue.name]) errors.push(`${label}: no sound called "${cue.name}".`);
  });
  for (const bed of film.beds ?? []) {
    if (!sounds[bed.name]) errors.push(`A bed uses a sound that isn't there: "${bed.name}".`);
    for (const end of [bed.from, bed.to]) if (!ids.has(end)) errors.push(`A bed runs from or to a shot that isn't there: "${end}".`);
  }
  return { film, errors };
}

// When each shot starts and ends in the cut: { [id]: { start, end } }, and the whole length.
export function timing(film) {
  const at = {};
  let t = 0;
  for (const shot of film.shots) {
    at[shot.id] = { start: t, end: t + shot.seconds };
    t += shot.seconds;
  }
  return { at, total: t };
}
