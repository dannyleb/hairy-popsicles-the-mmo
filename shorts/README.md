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
npm run short -- shorts/scripts/the-lost-eye.txt          # voices + a preview (stills), and the cost of the video
npm run short -- shorts/scripts/the-lost-eye.txt --yes    # the real thing: makes the video shots (costs fal credit)
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
- **Which voices can you use?** `npm run short -- --voices` lists the ones on
  your ElevenLabs account.

## Cast and voices

`cast.json` has everyone from the game, each with:
- `voice`: an ElevenLabs voice name.
- `look`: a description the video model reads.
- `lipsync: false`: for anyone without a mouth (Roast, Head Bloom). They move
  while the voice plays over.

Design a voice in ElevenLabs (Voice Design), then put its name in the
character's `voice`.

Better pictures make better video: drop a full-size render at
`shorts/characters/<id>.png` (for example `shorts/characters/conehead.png`)
and it's used instead of the game's 768px one.

## Services and keys

- **ElevenLabs** makes the voices: eleven_v3, which acts on the notes, or the
  voice changer for your own takes.
- **fal.ai** makes the video. Talking shots use Kling AI Avatar v2 (about
  $0.056 a second). Action shots use Kling v3 (about $0.084 a second, $0.42
  for 5 s). A 30-second short is around $1.50 to $2.
- Models and prices are in `kit.json`; change the model there to try another.

Keys:
- **In a Claude cloud session** (the "Hairy Popsicles" environment) they're
  saved on the environment and added on the way out. Nothing to do.
- **On your own computer**, make `shorts/.env` (it's never committed):
  ```
  ELEVENLABS_API_KEY=...
  FAL_KEY=...
  ```
- Needs Node 22+ and ffmpeg.

fal is pay as you go: add credit at fal.ai/dashboard/billing. If it runs out,
the kit stops and charges nothing. ElevenLabs' free plan is 10,000 characters
a month and, as far as we know, doesn't allow commercial use, so check their
terms before posting shorts that promote the game.
