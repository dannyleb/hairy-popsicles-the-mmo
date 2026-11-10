// A short, as written: settings at the top, then one shot per line.
//
//   title: The Lost Eye
//   DOOLIE: Has anyone seen my other eye?          someone talking
//   NERM (whispering): It's behind you.            ...with a note on how
//   DOOLIE (take: takes/scream.m4a): AAAAH!        ...in your own voice, recorded
//   > DOOLIE (3s): spins round, sweat flying off   something happening, no talking
//   > GREG & DOOLIE (3s): stare at each other      two of them, facing each other
//   > NERM (2s, still)                             a silent beat: no video made, free
//   > SCENE: the Navel gurgles                     just the background
//   prop: scab sunglasses = a crude little pair of sunglasses made of scabs
//   > SCAB SUNGLASSES (2s): glisten wetly          a prop on its own, close up
//
// Notes in brackets, comma-separated:
//   a length ("3s"), for > shots
//   "take: path": a recording to use, run through the character's voice
//   "sound": an action shot makes its own sound effects
//   camera, on the character only (the background stays still):
//     "close" (extreme close-up), "shake", "punch" (snaps in), "push" (creeps in)
//   "still": a held frame instead of video (beats, reactions; free)
//   "off": said off screen, heard over whoever was on screen last (their
//     reaction, held; free)
//   "with: <prop>": the prop is in the shot too, in front of them
//   "wearing: <prop>": they're wearing it (a version of their picture with it on)
//   "front", "left", "right": face the camera, or stand on that side
//   anything else: direction for how it's said and acted

export const SETTINGS = ['title', 'format', 'scene', 'music', 'ambience', 'background', 'captions', 'endcard', 'facing', 'vhs'];
export const CAMERA = ['close', 'shake', 'punch', 'push'];
const normal = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// The cast id for a name as written ("NERM", "redeye", "Spoon Nana"), or null.
export function findCharacter(written, cast) {
  const want = normal(written);
  for (const [id, c] of Object.entries(cast)) {
    if (id === '_') continue;
    if (normal(id) === want || normal(c.name ?? '') === want) return id;
  }
  return null;
}

function readNotes(text) {
  const notes = { seconds: null, take: null, sound: false, still: false, off: false, camera: [], side: null, with: null, wearing: null, direction: [] };
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const word = part.toLowerCase();
    const seconds = part.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?)$/i);
    const take = part.match(/^take\s*[:=]?\s*(.+)$/i);
    const prop = part.match(/^(with|wearing)\s*:\s*(.+)$/i);
    if (seconds) notes.seconds = Number(seconds[1]);
    else if (take) notes.take = take[1].trim();
    else if (prop) notes[prop[1].toLowerCase()] = prop[2].trim().toLowerCase();
    else if (/^(sound|sfx)$/.test(word)) notes.sound = true;
    else if (word === 'still') notes.still = true;
    else if (word === 'off' || word === 'o.s.' || word === 'offscreen') notes.off = true;
    else if (CAMERA.includes(word)) notes.camera.push(word);
    else if (['front', 'left', 'right'].includes(word)) notes.side = word;
    else notes.direction.push(part);
  }
  return notes;
}

// { settings, shots: [{ n, line, kind: 'talk'|'action', who, text, notes }], errors }
export function parseScript(source, cast) {
  const settings = { props: {} };
  const shots = [];
  const errors = [];
  const names = Object.entries(cast).filter(([id]) => id !== '_').map(([, c]) => c.name.toUpperCase());
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const action = line.startsWith('>');
    const body = action ? line.slice(1).trim() : line;
    // (A > shot can end at its notes: "> NERM (2s, still)".)
    const m = body.match(/^([^:()]+?)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/) ?? (action ? body.match(/^([^:()]+?)\s*\(([^)]*)\)\s*()$/) : null);
    if (!m) {
      errors.push(`line ${n}: "${line}" isn't a shot. Write NAME: what they say, or > NAME: what happens.`);
      return;
    }
    const [, who, noteText = '', words] = m;
    const text = words.trim();
    if (!action && !noteText && who.trim().toLowerCase() === 'prop') {
      const [name, description] = text.split('=').map((t) => t.trim());
      if (!name || !description) errors.push(`line ${n}: a prop is "prop: its name = what it looks like".`);
      else settings.props[name.toLowerCase()] = description;
      return;
    }
    if (!action && !noteText && SETTINGS.includes(who.trim().toLowerCase())) {
      settings[who.trim().toLowerCase()] = text;
      return;
    }
    // A prop on its own, close up.
    if (action && settings.props[who.trim().toLowerCase()]) {
      const notes = readNotes(noteText);
      shots.push({ n, line, kind: 'action', who: 'scene', cast: [], prop: who.trim().toLowerCase(), text, notes });
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
    if (!action && notes.still) errors.push(`line ${n}: "still" is for > shots (a talking line moves its mouth; "off" plays it over someone else).`);
    if (action && notes.off) errors.push(`line ${n}: "off" is for talking lines (said off screen).`);
    for (const used of [notes.with, notes.wearing].filter(Boolean)) {
      if (!settings.props[used]) errors.push(`line ${n}: no prop called "${used}": define it at the top, "prop: ${used} = what it looks like".`);
    }
    shots.push({ n, line, kind: action ? 'action' : 'talk', who: scene ? 'scene' : ids[0], cast: ids, text, notes });
  });
  if (!shots.length && !errors.length) errors.push('There are no shots in this script yet.');
  return { settings, shots, errors };
}
