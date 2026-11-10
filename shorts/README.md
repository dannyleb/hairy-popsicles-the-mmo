# Shorts kit

Hairy Popsicles, the show: skits of 30 to 60 seconds. Write one as a plain
text script, run one command, get the episode:
- the characters' own designed voices, lip-synced
- facing each other when they talk to each other
- the camera slamming in and shaking on them while the background stays put
- a title card and the hairypopsicles.com end card

Vertical (9:16) by default. Episodes are in `shorts/scripts/ep*.txt`.

How a shot is made: each character is animated on a flat green screen, keyed
out, and laid over a still background. So the background never warps, and
the camera moves (shake, punch, close) happen to the character alone.

## Write a script

One shot per line, in `shorts/scripts/<name>.txt`:

```
title: The Lost Eye
background: surface

BIG EYE: Has anyone seen my other eye?
RED EYE (whispering): Don't look at me. These are mine.
> CONEHEAD (4s): grins wider and wider until an eyeball rolls out of its mouth
CONEHEAD (guilty): ...finders keepers.
```

- `NAME: words`: someone talking, lip-synced. Anyone in `cast.json`
  (`RED EYE`, `redeye` and `Red Eye` all work).
- `NAME (note): words`: a note on how it's said and acted (`whispering`,
  `angry`, `laughing`). Several, comma-separated.
- `NAME (take: takes/line3.m4a): words`: use your own recording of the line,
  turned into the character's voice. The words are just for the captions.
- `> NAME (3s): what happens`: a shot with no talking. 3 to 15 seconds
  (4 if you don't say). Add `sound` in the brackets for sound effects made
  with the video.
- `> NAME & NAME (3s): what happens`: two of them in the shot, facing each
  other.
- `> NAME (1.5s, still)`: a silent beat, a reaction or an awkward pause.
  Their picture held, no video made, free. Good with `push` or `close`.
- `NAME (off): words`: said off screen, heard over whoever was on screen last
  (their reaction, held). Free.
- `> SCENE: what happens`: just the background, no character.
- **Props.** Define one at the top, `prop: scab sunglasses = a crude little
  pair of sunglasses made of dried scabs, one dark lens`, then:
  - `> SCAB SUNGLASSES (3s, push): they glisten wetly`: the prop on its own,
    an insert shot.
  - `with: scab sunglasses` in a shot's brackets: it's on the ground in front
    of them (between them in a two-shot).
  - `wearing: scab sunglasses`: everyone in the shot has it on.
  Each prop, and each character wearing one, is drawn once (about $0.15)
  and kept in `shorts/props/` and `shorts/characters/poses/`. A line said
  off screen shows the same prop as the shot it's said over.
- **Camera notes** (in the brackets, on any shot) move the character only:
  - `close`: extreme close-up
  - `punch`: snaps in
  - `shake`
  - `push`: creeps in
- **Who faces whom:** with two or more in a skit, the first to appear stands
  on the left facing right, the next on the right facing left. A
  `left` / `right` / `front` note moves someone for one shot;
  `facing: front` at the top keeps everyone facing the camera (solo episodes).
  The turned pictures are drawn once per character and kept in
  `shorts/characters/poses/` (about $0.15 each).
  `npm run short -- --pose bigeye,conehead` draws them ahead of time, with a
  sheet to check them.
- Settings at the top, all optional:
  - `title:` (shown over the opening)
  - `scene:` the episode's own environment, described ("a dreary little
    office made of flesh, a framed picture of a toenail on the wall"). It's
    painted once in the show's style (nano-banana-pro, about $0.15) and kept
    in `shorts/backgrounds/`. Change the words and it paints a new one. The
    video shots don't need remaking: the scene is only the still background.
  - `format: vertical | wide`
  - `background: surface | deep | black | path/to/picture.png` (when there's
    no scene: the game's ground)
  - `music: creepy-box | creepy-theme | music-box | theme | none`, or a file
    in `shorts/music/`. The default is `creepy-box`. The game's Suno tracks,
    slowed and detuned for the creepy ones. Music drops under the voices and
    swells back in the pauses.
  - `ambience: wind | hum | gut | none` (a bed under everything; wind by default)
  - `captions: on | names | off` (off unless you say)
  - `facing: front` (everyone faces the camera)
  - `endcard: off` (skips the hairypopsicles.com card)
- Lines starting with `#` are notes to yourself.

How to write them (the show's voice, rhythm, beats): see `WRITING.md`.

## Make it

```
npm run short -- shorts/scripts/the-lost-eye.txt          # voices (a few cents) + a preview (stills), and the cost of the video
npm run short -- shorts/scripts/the-lost-eye.txt --yes    # the real thing: makes the video shots (about $1.50-2 for 30 s)
```

The result is in `shorts/out/<name>/`: `<name>.mp4`, plus `<name>.srt` if you
want to upload captions separately. Until every shot has video, it's
`<name>-preview.mp4`, with stills standing in.

- **Change a line, run again.** Everything is kept, keyed by what went into
  it, so only what changed is remade (and paid for).
- **Don't like a take?** `--redo 3` remakes shot 3's video. `--revoice 3`
  remakes its voice.
- **Testing without spending anything?** `--offline` uses silent placeholder
  voices and stills.

## Cast and voices

Each character in `cast.json` has its own designed voice:
- `brief`: the voice, described. Odd, abrasive, wet, wheezing: whatever fits
  the face. Design it (or design it again) with:
  ```
  npm run short -- --design conehead,bigeye     # or --design all
  ```
  That makes a voice from the brief, saves it in `voices.json`, and puts an
  audition in `shorts/out/voices/audition.mp3`. Don't like it? Change the
  brief and design again. Each design is a cent or two. A character with no
  voice yet gets one designed the first time a script needs it.
- `manner`: how they always talk (`"manic, too cheerful"`), used on every
  line without its own note. A note in the script replaces it for that line.
- `fx`: what's done to the voice afterwards, stacked in order:
  - pitch and size: `deep`, `deeper`, `high`, `tiny`
  - wobble: `warble`, `tremble`, `gurgle`
  - texture: `wet`, `crunch`, `rasp`, `whisper`, `static`
  - space: `choir`, `echo`, `uncanny`
- `voiceOf`: share another character's voice (the snoots do).
- `look`: what they are, for the video model.
- `lipsync: false`: anyone without a mouth (Roast, Head Bloom); they move
  while the voice plays over.

Change a character's `fx` or `manner` and run the script again: only their
lines are remade. `--revoice 3` re-says line 3 (every take differs a little).

Better pictures make better video: drop a full-size render at
`shorts/characters/<id>.png` (for example `shorts/characters/conehead.png`)
and it's used instead of the game's 768px one.

## Services and keys

Everything runs on **fal.ai**, from one balance:
- **Voices:** designed and spoken by ElevenLabs v3 on fal, at $0.10 per
  1,000 characters. fal's page says commercial use is included.
- **Talking shots:** Kling AI Avatar v2, about $0.056 a second.
- **Action shots:** Kling v3, about $0.084 a second ($0.42 for 5 s).
- **Turned poses, props, characters wearing props:** nano-banana-pro, $0.15
  each, drawn once.
- **Your own takes:** ElevenLabs' voice changer on fal.

An episode of 30 to 40 seconds is around $2. Models and prices are in
`kit.json`; change the model there to try another.

(`voice.provider: "elevenlabs"` in `kit.json` uses your own ElevenLabs
account and the stock voices named in `cast.json` instead. Stock voices only:
designing voices through ElevenLabs' own API needs a paid plan.
`npm run short -- --voices` lists them.)

Keys:
- **In a Claude cloud session** (the "Hairy Popsicles" environment) they're
  saved on the environment and added on the way out. Nothing to do.
- **On your own computer**, make `shorts/.env` (it's never committed):
  ```
  FAL_KEY=...
  ELEVENLABS_API_KEY=...     # only for provider "elevenlabs"
  ```
- Needs Node 22+ and ffmpeg.

fal is pay as you go: add credit at fal.ai/dashboard/billing. If it runs out,
the kit stops and charges nothing more. A failed or cut-off run picks up
where it stopped instead of paying again.
