// A short, as written: settings at the top, then one shot per line.
//
//   title: The Lost Eye
//   CONEHEAD: Has anyone seen my other eye?            someone talking
//   REDEYE (whispering): It's behind you.              ...with a note on how
//   CONEHEAD (take: takes/scream.m4a): AAAAH!          ...in your own voice, recorded
//   > CONEHEAD (3s): spins round, sweat flying off     something happening, no talking
//   > BIG EYE & CONEHEAD (3s): stare at each other     two of them, facing each other
//   > RED EYE (2s, still)                              a silent beat: no video made, free
//   > SCENE: the Navel gurgles                         just the background
//
// Notes in brackets, comma-separated:
//   a length ("3s"), for > shots
//   "take: path": a recording to use, run through the character's voice
//   "sound": an action shot makes its own sound effects
//   camera, on the character only (the background stays still):
//     "close" (extreme close-up), "shake", "punch" (snaps in), "push" (creeps in)
//   "still": a held frame instead of video (beats, reactions; free)
//   "front", "left", "right": face the camera, or stand on that side
//   anything else: direction for how it's said and acted

export const SETTINGS = ['title', 'format', 'music', 'background', 'captions', 'endcard', 'facing'];
export const CAMERA = ['close', 'shake', 'punch', 'push'];
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
  const notes = { seconds: null, take: null, sound: false, still: false, camera: [], side: null, direction: [] };
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const word = part.toLowerCase();
    const seconds = part.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?)$/i);
    const take = part.match(/^take\s*[:=]?\s*(.+)$/i);
    if (seconds) notes.seconds = Number(seconds[1]);
    else if (take) notes.take = take[1].trim();
    else if (/^(sound|sfx)$/.test(word)) notes.sound = true;
    else if (word === 'still') notes.still = true;
    else if (CAMERA.includes(word)) notes.camera.push(word);
    else if (['front', 'left', 'right'].includes(word)) notes.side = word;
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
    // (A > shot can end at its notes: "> RED EYE (2s, still)".)
    const m = body.match(/^([^:()]+?)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/) ?? (action ? body.match(/^([^:()]+?)\s*\(([^)]*)\)\s*()$/) : null);
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
    const written = action ? who.split('&').map((w) => w.trim()).filter(Boolean) : [who.trim()];
    if (!action && who.includes('&')) {
      errors.push(`line ${n}: one talker at a time. Two of them together is a > shot: > ${who.trim()}: what happens.`);
      return;
    }
    const ids = scene ? [] : written.map((w) => findCharacter(w, cast));
    const unknown = written.filter((w, i) => !scene && !ids[i]);
    if (unknown.length) {
      errors.push(`line ${n}: nobody called "${unknown.join('" or "')}" in the cast (shorts/cast.json). The cast: ${names.join(', ')}.`);
      return;
    }
    if (ids.length > 2) {
      errors.push(`line ${n}: at most two in a shot.`);
      return;
    }
    const notes = readNotes(noteText);
    if (!text && !(action && notes.still)) {
      errors.push(`line ${n}: ${action ? 'what happens' : 'what they say'} is missing after the colon.`);
      return;
    }
    if (!action && notes.seconds) errors.push(`line ${n}: a talking line is as long as it takes to say; lengths are for > action shots.`);
    if (!action && notes.still) errors.push(`line ${n}: "still" is for > shots (a talking line moves its mouth).`);
    shots.push({ n, line, kind: action ? 'action' : 'talk', who: scene ? 'scene' : ids[0], cast: ids, text, notes });
  });
  if (!shots.length && !errors.length) errors.push('There are no shots in this script yet.');
  return { settings, shots, errors };
}
