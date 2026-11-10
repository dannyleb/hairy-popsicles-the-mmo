// The shorts kit's script reader and captions (no services, no server).
import { readFileSync } from 'node:fs';
import { check, finish } from './lib.mjs';
import { captionsAss, captionsSrt } from '../shorts/lib/captions.mjs';
import { findCharacter, parseScript } from '../shorts/lib/script.mjs';
import { audioTags } from '../shorts/lib/services.mjs';

const cast = JSON.parse(readFileSync(new URL('../shorts/cast.json', import.meta.url), 'utf8'));

check('names match however they are written', findCharacter('RED EYE', cast) === 'redeye' && findCharacter('Spoon Nana', cast) === 'spoon-nana' && findCharacter('conehead', cast) === 'conehead');
check('...and nobody else', findCharacter('Gary', cast) === null);

const { settings, shots, errors } = parseScript(`
# a note
title: Test: The Sequel
format: wide

BIG EYE: Has anyone seen my eye? It's: gone.
RED EYE (whispering, slowly): Not me.
CONEHEAD (take: takes/scream.m4a): AAAAH!
> CONEHEAD (3s, sound): spins round
> SCENE: the Navel gurgles
`, cast);
check('settings at the top', settings.title === 'Test: The Sequel' && settings.format === 'wide', JSON.stringify(settings));
check('every shot, in order', shots.map((s) => `${s.kind}:${s.who}`).join() === 'talk:bigeye,talk:redeye,talk:conehead,action:conehead,action:scene', shots.map((s) => s.who).join());
check('words keep their own colons', shots[0].text === "Has anyone seen my eye? It's: gone.");
check('notes: direction', shots[1].notes.direction.join('|') === 'whispering|slowly');
check('notes: a recorded take', shots[2].notes.take === 'takes/scream.m4a');
check('notes: length and sound', shots[3].notes.seconds === 3 && shots[3].notes.sound === true);
check('a clean script has no errors', errors.length === 0, errors.join('; '));

const bad = parseScript('GARY: hello\nBIG EYE (3s): hi\njust some words\nCONEHEAD:', cast);
check('unknown names, lengths on talking lines, non-shots and empty lines are all caught', bad.errors.length === 4, bad.errors.join(' / '));
check('...each with its line number', bad.errors.every((e) => /^line \d+:/.test(e)));

check('notes go to the voice as separate tags', audioTags('guilty, mouth full') === '[guilty] [mouth full]');

const show = parseScript(`
facing: front
> BIG EYE & CONEHEAD (3s, shake): stare at each other
> RED EYE (2s, still, close, push)
BIG EYE (screaming, punch, left): WHAT
`, cast);
check('two in a shot', show.shots[0].cast.join() === 'bigeye,conehead' && show.shots[0].notes.camera.join() === 'shake', JSON.stringify(show.shots[0]));
check('a silent beat needs no words', show.shots[1].notes.still && show.shots[1].text === '' && show.shots[1].notes.camera.join() === 'close,push', show.errors.join('; '));
check('camera and side notes come out of the direction', show.shots[2].notes.direction.join() === 'screaming' && show.shots[2].notes.camera.join() === 'punch' && show.shots[2].notes.side === 'left');
check('facing is a setting', show.settings.facing === 'front');
const wrong = parseScript('BIG EYE & CONEHEAD: hi\n> A & B & C: x\nBIG EYE (still): hi', cast);
check('two talking at once, unknowns in a pair, and still talking lines are caught', wrong.errors.length === 3, wrong.errors.join(' / '));
for (const file of ['ep1-the-sunglasses', 'ep2-the-interview', 'ep3-liar', 'ep4-first-date', 'ep5-four-sheep']) {
  const episode = parseScript(readFileSync(new URL(`../shorts/scripts/${file}.txt`, import.meta.url), 'utf8'), cast);
  check(`${file} reads cleanly`, episode.errors.length === 0 && episode.shots.length > 5, episode.errors.join('; '));
}

const lines = [{ start: 0.05, end: 2.4, who: 'Big Eye', text: 'Has anyone {seen} my eye?' }];
const ass = captionsAss({ size: [1080, 1920], lines, names: true, title: 'T', endcard: { start: 10, end: 13, title: 'Hairy Popsicles', line: 'Play' } });
check('captions: timed, braces stripped, name shown', ass.includes('0:00:00.05,0:00:02.40,Line') && ass.includes('Has anyone seen my eye?') && ass.includes('BIG EYE'));
check('captions: title and end card', ass.includes(',Title,') && ass.includes(',End,') && ass.includes('Play'));
check('srt timing', captionsSrt(lines).includes('00:00:00,050 --> 00:00:02,400'), captionsSrt(lines));
finish();
