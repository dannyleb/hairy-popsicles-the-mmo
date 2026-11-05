import { check, finish } from './lib.mjs';
import { checkText, maskText, hasBlocked } from '../packages/server/src/game/filter.js';

const category = (text) => checkText(text).category;
check('clean text untouched', maskText('this pimple is ripe, go squeeze it') === 'this pimple is ripe, go squeeze it');
check('gross is fine', maskText('pus snot puke drool scab') === 'pus snot puke drool scab');
check("the game's own words are fine", ['the gash is up', 'pus seed', 'bone seed', 'pick the crust out of the gash', 'squeeze the blackheads', 'pop the boil', 'ingrown hair', 'navel lint'].every((t) => category(t) === null));
check('slur masked', maskText('you fag') === 'you ***');
check('l33t and repeats caught', maskText('n1gggaaa lol') === '******** lol');
check('the n-word is caught, plain and disguised (an allowed look-alike once let it through)', ['nigger', 'n1gger', 'NIGGER', 'n i g g e r'].every((t) => category(t) === 'hate'));
check('the country is still fine', category('Niger and Nigeria') === null);
check('punctuation inside a word caught', hasBlocked('f.a.g'));
check('whole-word roots spare longer words', maskText('spice up the spicy scunthorpe grapes') === 'spice up the spicy scunthorpe grapes');
check('anywhere roots inside words caught', hasBlocked('superretardedness'));
check('allowed words kept', maskText('cucumber document drape') === 'cucumber document drape');
check('no false alarms on look-alikes', !['therapist', 'torpedo', 'vacuum', 'Nigeria', 'scum', 'grape', 'raccoon', 'speedometer', 'accumulate', 'scrape', 'circumstance', 'analysis', 'Sussex', 'cockpit', 'shiitake', 'flame retardant', 'k', 'ok k'].some(hasBlocked));
check('whole-word forms caught', ['raped', 'r4pe', 'p0rn', 'Nazi!'].every(hasBlocked));
check('names checked', hasBlocked('xXRapistXx') && !hasBlocked('Danny'));

// Sorted by how bad: the first three are a strike, swearing is only masked.
check('hate', ['you absolute fag', 'kkk', 'grammar nazi'].every((t) => checkText(t).category === 'hate' && checkText(t).strike));
check('sexual', ['send nudes', 'r4pe', 'suck my dick'].every((t) => checkText(t).category === 'sexual' && checkText(t).strike));
check('telling someone to hurt themselves', ['kys', 'k y s', 'KYS lol', 'kill yourself', 'kill urself', 'killyourself', 'go die', 'i hope u die', 'neck yourself'].every((t) => checkText(t).category === 'harassment'));
check('threats', ['I will kill you', "i'll kill you", 'i know where you live'].every((t) => checkText(t).category === 'harassment'));
check('abuse aimed at someone', ['fuck you', 'go fuck yourself', 'you idiot', 'you are an idiot', "you're so stupid", 'u r trash', 'are you dumb', 'you bitch'].every((t) => checkText(t).category === 'harassment' && checkText(t).strike));
check('...but not the same words aimed at nothing', ['this boil is stupid', 'you got trash luck', 'thank you, that was dumb of me', 'the boil will kill you', 'you rock', 'thank you so much'].every((t) => category(t) === null));
check('swearing: masked, not a strike', ['oh shit', 'fuck this boil', 'bitch please'].every((t) => checkText(t).category === 'profanity' && !checkText(t).strike) && maskText('fuck this boil') === '**** this boil');
check('the worst thing in a line decides', category('shit you absolute fag') === 'hate');
finish();
