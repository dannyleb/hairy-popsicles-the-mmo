// A short, as written: settings at the top, then one shot per line.
//
//   title: The Lost Eye
//   CONEHEAD: Has anyone seen my other eye?            someone talking
//   REDEYE (whispering): It's behind you.              ...with a note on how
//   CONEHEAD (take: takes/scream.m4a): AAAAH!          ...in your own voice, recorded
//   > CONEHEAD (3s): spins round, sweat flying off     something happening, no talking
//   > SCENE: the Navel gurgles                         just the background
//
// Notes in brackets, comma-separated: a length ("3s"), a recording to use
// ("take: path", run through the character's voice), "sound" (an action
// shot makes its own sound effects), and anything else is direction for how
// it's said and acted.

export const SETTINGS = ['title', 'format', 'music', 'background', 'captions', 'endcard'];
const normal = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// The cast id for a name as written ("RED EYE", "redeye", "Spoon Nana"), or null.
export function findCharacter(written, cast) {
  const want = normal(written);
  for (const [id, c] of Object.entries(cast)) {
    if (id === '_') continue;
    if (normal(id) === want || normal(c.name ?? '') === want) return id;
  }
  return null;
}

function readNotes(text) {
  const notes = { seconds: null, take: null, sound: false, direction: [] };
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const seconds = part.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?)$/i);
    const take = part.match(/^take\s*[:=]?\s*(.+)$/i);
    if (seconds) notes.seconds = Number(seconds[1]);
    else if (take) notes.take = take[1].trim();
    else if (/^(sound|sfx)$/i.test(part)) notes.sound = true;
    else notes.direction.push(part);
  }
  return notes;
}

// { settings, shots: [{ n, line, kind: 'talk'|'action', who, text, notes }], errors }
export function parseScript(source, cast) {
  const settings = {};
  const shots = [];
  const errors = [];
  const names = Object.entries(cast).filter(([id]) => id !== '_').map(([, c]) => c.name.toUpperCase());
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const action = line.startsWith('>');
    const body = action ? line.slice(1).trim() : line;
    const m = body.match(/^([^:()]+?)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/);
    if (!m) {
      errors.push(`line ${n}: "${line}" isn't a shot. Write NAME: what they say, or > NAME: what happens.`);
      return;
    }
    const [, who, noteText = '', words] = m;
    const text = words.trim();
    if (!action && !noteText && SETTINGS.includes(who.trim().toLowerCase())) {
      settings[who.trim().toLowerCase()] = text;
      return;
    }
    const scene = action && normal(who) === 'scene';
    const id = scene ? 'scene' : findCharacter(who, cast);
    if (!id) {
      errors.push(`line ${n}: nobody called "${who.trim()}" in the cast (shorts/cast.json). The cast: ${names.join(', ')}.`);
      return;
    }
    if (!text) {
      errors.push(`line ${n}: ${action ? 'what happens' : 'what they say'} is missing after the colon.`);
      return;
    }
    const notes = readNotes(noteText);
    if (!action && notes.seconds) errors.push(`line ${n}: a talking line is as long as it takes to say; lengths are for > action shots.`);
    shots.push({ n, line, kind: action ? 'action' : 'talk', who: id, text, notes });
  });
  if (!shots.length && !errors.length) errors.push('There are no shots in this script yet.');
  return { settings, shots, errors };
}
