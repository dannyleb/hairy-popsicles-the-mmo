// The shorts kit's script reader and captions (no services, no server).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check, finish } from './lib.mjs';
import { captionsAss, captionsSrt } from '../shorts/lib/captions.mjs';
import { readFilm, timing } from '../shorts/lib/film.mjs';
import { findCharacter, parseScript } from '../shorts/lib/script.mjs';
import { audioTags } from '../shorts/lib/services.mjs';

const cast = JSON.parse(readFileSync(new URL('../shorts/cast.json', import.meta.url), 'utf8'));

check('names match however they are written', findCharacter('NERM', cast) === 'redeye' && findCharacter('Spoon Nana', cast) === 'spoon-nana' && findCharacter('conehead', cast) === 'conehead');
check('...and by their id, under any name they had before', findCharacter('Doolie', cast) === 'conehead' && findCharacter('RED EYE', cast) === 'redeye' && findCharacter('The Aunties', cast) === 'head-bloom');
check('...and nobody else', findCharacter('Gary', cast) === null);

const { settings, shots, errors } = parseScript(`
# a note
title: Test: The Sequel
format: wide

GREG: Has anyone seen my eye? It's: gone.
NERM (whispering, slowly): Not me.
DOOLIE (take: takes/scream.m4a): AAAAH!
> DOOLIE (3s, sound): spins round
> SCENE: the Navel gurgles
`, cast);
check('settings at the top', settings.title === 'Test: The Sequel' && settings.format === 'wide', JSON.stringify(settings));
check('every shot, in order', shots.map((s) => `${s.kind}:${s.who}`).join() === 'talk:bigeye,talk:redeye,talk:conehead,action:conehead,action:scene', shots.map((s) => s.who).join());
check('words keep their own colons', shots[0].text === "Has anyone seen my eye? It's: gone.");
check('notes: direction', shots[1].notes.direction.join('|') === 'whispering|slowly');
check('notes: a recorded take', shots[2].notes.take === 'takes/scream.m4a');
check('notes: length and sound', shots[3].notes.seconds === 3 && shots[3].notes.sound === true);
check('a clean script has no errors', errors.length === 0, errors.join('; '));

const bad = parseScript('GARY: hello\nGREG (3s): hi\njust some words\nDOOLIE:', cast);
check('unknown names, lengths on talking lines, non-shots and empty lines are all caught', bad.errors.length === 4, bad.errors.join(' / '));
check('...each with its line number', bad.errors.every((e) => /^line \d+:/.test(e)));

check('notes go to the voice as separate tags', audioTags('guilty, mouth full') === '[guilty] [mouth full]');

const show = parseScript(`
facing: front
> GREG & DOOLIE (3s, shake): stare at each other
> NERM (2s, still, close, push)
GREG (screaming, punch, left): WHAT
`, cast);
check('two in a shot', show.shots[0].cast.join() === 'bigeye,conehead' && show.shots[0].notes.camera.join() === 'shake', JSON.stringify(show.shots[0]));
check('a silent beat needs no words', show.shots[1].notes.still && show.shots[1].text === '' && show.shots[1].notes.camera.join() === 'close,push', show.errors.join('; '));
check('camera and side notes come out of the direction', show.shots[2].notes.direction.join() === 'screaming' && show.shots[2].notes.camera.join() === 'punch' && show.shots[2].notes.side === 'left');
check('facing is a setting', show.settings.facing === 'front');
const offscreen = parseScript('DOOLIE (off, softly): I made you something.\n> DOOLIE (off): x', cast);
check('a line said off screen', offscreen.shots[0].notes.off && offscreen.shots[0].notes.direction.join() === 'softly');
check('...but not an action', offscreen.errors.length === 1, offscreen.errors.join('; '));
const wrong = parseScript('GREG & DOOLIE: hi\n> A & B & C: x\nGREG (still): hi', cast);
check('two talking at once, unknowns in a pair, and still talking lines are caught', wrong.errors.length === 3, wrong.errors.join(' / '));
const props = parseScript(`
prop: Scab Sunglasses = crusty little sunglasses made of scabs
> GREG & DOOLIE (3s, with: scab sunglasses): they stare at them
> SCAB SUNGLASSES (2s, push): they glisten
GREG (quietly, wearing: Scab Sunglasses): ...they're warm.
`, cast);
check('props: defined at the top, by name', props.settings.props['scab sunglasses'] === 'crusty little sunglasses made of scabs' && props.errors.length === 0, props.errors.join('; '));
check('props: held in a shot, worn, and shown on their own', props.shots[0].notes.with === 'scab sunglasses' && props.shots[2].notes.wearing === 'scab sunglasses' && props.shots[2].notes.direction.join() === 'quietly'
  && props.shots[1].prop === 'scab sunglasses' && props.shots[1].who === 'scene' && props.shots[1].cast.length === 0 && props.shots[1].notes.camera.join() === 'push');
const noProp = parseScript('GREG (wearing: a hat): hi\nprop: = nothing', cast);
check('props: an undefined or half-written prop is caught', noProp.errors.length === 2, noProp.errors.join(' / '));
check('vhs: off turns the static off for one script', parseScript('vhs: off\nGREG: hi', cast).settings.vhs === 'off');
const sound = parseScript('room: cavern\nsounds: drips, slime\nenergy: calm\nGREG: hi', cast).settings;
check('room, sounds and energy are settings', sound.room === 'cavern' && sound.sounds === 'drips, slime' && sound.energy === 'calm', JSON.stringify(sound));
for (const file of ['ep1-the-sunglasses', 'ep2-the-interview', 'ep3-liar', 'ep4-first-date', 'ep5-four-sheep']) {
  const episode = parseScript(readFileSync(new URL(`../shorts/scripts/${file}.txt`, import.meta.url), 'utf8'), cast);
  check(`${file} reads cleanly`, episode.errors.length === 0 && episode.shots.length > 5, episode.errors.join('; '));
}

const lines = [{ start: 0.05, end: 2.4, who: 'Greg', text: 'Has anyone {seen} my eye?' }];
const ass = captionsAss({ size: [1080, 1920], lines, names: true, title: 'T', endcard: { start: 10, end: 13, title: 'Hairy Popsicles', line: 'Play' } });
check('captions: timed, braces stripped, name shown', ass.includes('0:00:00.05,0:00:02.40,Line') && ass.includes('Has anyone seen my eye?') && ass.includes('GREG'));
check('captions: title and end card', ass.includes(',Title,') && ass.includes(',End,') && ass.includes('Play'));
check('srt timing', captionsSrt(lines).includes('00:00:00,050 --> 00:00:02,400'), captionsSrt(lines));

// Films (shorts/films/<name>/film.json): the cut list reads, and is under a minute.
const itch = readFilm(fileURLToPath(new URL('../shorts/films/the-itch', import.meta.url)), cast);
check('the-itch film reads cleanly', itch.errors.length === 0 && itch.film.shots.length >= 10, itch.errors.join('; '));
const cut = timing(itch.film);
check('...and runs under a minute, shots back to back', cut.total <= 60 && cut.at['01-skin'].start === itch.film.shots[0].seconds, String(cut.total));
const badFilm = readFilm(fileURLToPath(new URL('./fixtures/bad-film', import.meta.url)), cast);
check('a film with mistakes says what they are', badFilm.errors.length === 4, badFilm.errors.join(' / '));
finish();
