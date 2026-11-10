# Shorts kit

Write a short as a plain text script, run one command, get a first-pass
video: voices, lip-synced talking shots, action shots, captions, music and an
end card. Vertical (9:16) by default.

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
- `> SCENE: what happens`: just the background, no character.
- Settings at the top, all optional:
  - `title:` (shown over the opening)
  - `format: vertical | wide`
  - `background: surface | deep | black | path/to/picture.png`
  - `music: music/song.mp3` (plays quietly under everything)
  - `captions: on | names | off`
  - `endcard: off` (skips the "Play free at hairypopsicles.com" card)
- Lines starting with `#` are notes to yourself.

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
- **Your own takes:** ElevenLabs' voice changer on fal.

A 30-second short is around $1.50 to $2. Models and prices are in
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
