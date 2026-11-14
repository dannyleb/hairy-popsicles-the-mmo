# Shorts kit

Hairy Popsicles, the show: skits of 30 to 60 seconds. Write one as a plain
text script, run one command, get the episode:
- the characters' own designed voices, lip-synced
- facing each other when they talk to each other
- the camera slamming in and shaking on them while the background stays put
- a title card and the hairypopsicles.com end card

Vertical (9:16) by default. Episodes are in `shorts/scripts/ep*.txt`.
The world, its residents and the plan for bigger video: `shorts/WORLD.md`.

How a shot is made: each character is animated on a flat green screen, keyed
out, and laid over a still background. So the background never warps, and
the camera moves (shake, punch, close) happen to the character alone. Their
shadow is their own outline laid flat on the floor where they stand, so it
moves with them. Write scenes with a floor across the lower part of the
picture (rooms work best: the light matches the characters).

## Write a script

One shot per line, in `shorts/scripts/<name>.txt`:

```
title: The Lost Eye
background: surface

GREG: Has anyone seen my other eye?
NERM (whispering): Don't look at me. These are mine.
> DOOLIE (4s): grins wider and wider until an eyeball rolls out of its mouth
DOOLIE (guilty): ...finders keepers.
```

- `NAME: words`: someone talking, lip-synced. Anyone in `cast.json`
  (`NERM`, `Nerm` and `nerm` all work, and so does their id in `cast.json`,
  like `redeye`).
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
  (their face, held). Free. Only for a voice that isn't in the scene (a
  phone, a narrator): a viewer needs to see who's talking.
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
- **Letters under someone?** The lip-sync model now and then writes made-up
  subtitles under a character. Remake the shot (`--redo 3`), or, when it
  keeps doing it and the character doesn't reach that low, key out the
  bottom of that shot's video: `PUD (sniffling, mask: 0.76): ...` hides
  everything below 76% of its height. Free: nothing is made again.
- **Who faces whom:** with two or more in a skit, the first to appear stands
  on the left facing right, the next on the right facing left. A
  `left` / `right` / `front` note moves someone for one shot;
  `facing: front` at the top keeps everyone facing the camera (solo episodes).
  The turned pictures are drawn once per character and kept in
  `shorts/characters/poses/` (about $0.15 each).
  `npm run short -- --pose bigeye,conehead` draws them ahead of time, with a
  sheet to check them. The image model sometimes turns a head the wrong way:
  check, and mirror any that face away with
  `npm run short -- --flip shiv-left` (free; the shots with it are remade).
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
    slowed and detuned for the creepy ones. It plays under the title and
    fades away as the first line is said.
  - `sounds:` the episode's environment, described ("muggy room tone, slow
    wet drips into a sticky puddle, a fly buzzing now and then"). Made once
    into a 20-second loop (about $0.04) and kept in `shorts/sounds/`. It
    plays under everything, dipping a little under the voices.
  - `saliva: shiv` (or `shiv, hork`): the wet sound of their mouth
    close-up runs under the whole episode at one steady level, slices of it
    crossfaded so it never audibly loops (Liar has it: Shiv's hotdog).
  - `draft: yes`: keeps it off hairypopsicles.com/episodes until it's ready
    (`npm run episodes` leaves it out).
  - `room: small | large | cavern | none`: the space the voices ring in
    (small unless you say). Their echo off the walls is what puts them in
    the scene instead of on top of it. Voices also come from where the
    speaker stands, left or right.
  - `ambience: wind | hum | gut | none` (a made-up bed, for a script with no
    `sounds:`; wind by default)
  - `energy: calm` (the camera holds still; by default it's `frantic`: it
    trembles, snaps in at random, and every slam, shake and snap to a
    close-up gets a sound hit)
  - `vhs: off` (no bursts of VHS static; they're on by default, every few
    seconds in the gaps between lines, picture and sound)
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
  it, so only what changed is remade (and paid for). Each line's raw take is
  kept too, so changing a character's effects (cast.json `fx`) treats the
  same performance again rather than recording a new one.
- **Don't like a take?** `--redo 3` remakes shot 3's video. `--revoice 3`
  remakes its voice.
- **Testing without spending anything?** `--offline` uses silent placeholder
  voices and stills.

## Films: shots made elsewhere

The kit makes dialogue: characters on a green screen over a still room. For
the big picture (landscapes, camera moves, the Eye opening) a **film** takes
its shots from anywhere that hands back a video file (Higgsfield, the kit's
own video model, a phone) and cuts them with the kit's voices, sound, VHS
static and titles:

```
npm run film -- the-itch           # where it stands, and the cut (the animatic until every shot is filmed)
npm run film -- the-itch --yes     # first makes what's missing and costs money (key frames, sounds, lines)
npm run film -- the-itch --shots   # the shot list to film from: each key frame, how long, the prompt
```

A film is a folder, `shorts/films/<name>/`, all of it committed:
- `film.json`: the cut list. Each shot has an id, how long it runs, a key
  frame (painted from a description, or a character stood in a set that's
  already painted: free), a prompt and camera note for whoever films it,
  sound cues and maybe a line. `lib/film.mjs` lists every field.
- `frames/<id>.jpg`: the key frames. Film each shot **from its key frame**
  (image-to-video), so the characters and the world stay as drawn.
- `clips/<id>.mp4`: the filmed shots, dropped in under the shot's id (any
  size or length: they're fitted, and `speed` slows one down). Until a
  shot's clip is there its key frame stands in, drifting, marked "still".
- `sounds/`, `voices/`: made once (`--yes`), kept. Delete one to make it again.

The mix is left as it's laid out, quiet parts quiet (an episode's dialogue is
evened out instead), then brought to `loudness` as a whole.

**Filming on Higgsfield** (a connector on claude.ai). Where the session runs
decides who pays:
- **A Claude chat** (claude.ai, Cowork or ChatGPT, with Higgsfield connected)
  can film on a free trial's unlimited generations. Those cover Seedance 2.0
  and 2.5 for video (and Nano Banana, GPT Image, Seedream and Soul for
  pictures, Text to Speech and Seed Audio for sound).
- **A Claude Code session** (this kit's home) can't: Higgsfield refuses
  unlimited generations there, so everything it films costs credits.

So the shots are filmed in a chat and cut here:
1. Push the key frames, then `npm run film -- <name> --chat`. It prints what to
   paste into a Claude chat: every shot not filmed yet, its key frame's GitHub
   address, its prompt, and the settings (`kit.json`, `film.chat`). The chat
   imports each key frame (`media_import_url`), films it with `use_unlim: true`
   and never on credits, and answers with the job ids without waiting for
   the videos (waiting spends the chat's usage limit for nothing). One take
   of each: ask again for the shots that need another.
2. In the Code session, find the finished jobs (`show_generations`, or
   `show_generation_by_ids` with the ids), pick a take of each, download it
   into `clips/<id>.mp4` (its host has to be allowed in the environment's
   network settings), and cut.

Filming from a Code session on credits works the same way with
`generate_video` (quote first with `get_cost: true`): in November 2026 a
5-second vertical shot cost 5 credits on Cinema Studio Video or Grok Video
Lite, 7.5 on Kling 3.0, 35 on Seedance 2.5. The cloud session can't reach
Higgsfield's upload server, and doesn't need to: `media_import_url` takes the
key frame's raw GitHub address.

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
- `voiceOf`: share another character's voice.
- `look`: what they are, for the video model.
- `lipsync: false`: anyone without a mouth (Glorp, The Aunties); they move
  while the voice plays over.
- `mouthful`: they talk with something in their mouth (Shiv and his hotdog).
  `{ "tags": "[talking with his mouth full]", "pause": "[chews]" }`:
  `tags` go to the voice model before every line, `pause` goes in at every
  break between sentences (so he chews between them), the voice is muffled
  afterwards, and the saliva sound of their mouth close-up runs quietly under
  each line (kit.json `mouth.wetUnderVoice`). For that sound under the whole
  episode at one level instead, put `saliva: shiv` in the script (several:
  `saliva: shiv, hork`): it runs start to finish, kit.json
  `mouth.salivaBelow` dB (9) under the dialogue, and the per-shot wet sounds
  give way to it.
- `chorus`: `{ "voice": "aunties-chorus" }` puts a chorus of small high voices
  under every line, in unison (The Aunties: their little skulls all talk).
  Each line's take goes through the voice changer into that voice (a key in
  voices.json; it must be voiced, not a whisper), then a few pitched-up
  copies of it, a few milliseconds apart (kit.json `voice.chorus`). About a
  cent a line.
- `keyStrength`: how much of the green (or blue) screen colour is keyed out
  around them, 0.28 unless set. Lower it for someone glossy or wet who picks
  up the screen's colour and goes see-through at the edges (Glorp and his
  juices: 0.13; below 0.2 the edge is softened too, so no dark outline).
  Free: only the cut is made again.
- `steady: true`: no camera tremble or jolts on their shots (energy:
  frantic still shakes everyone else). For someone small and spindly the
  tremble just throws about (Mabel).
- `key: "blue"`: they're made on a blue screen, not green: for anyone with
  green on them (Mabel's mushroom is green moss, which the green key cut
  holes in). Blue's edges are cleaned of any lavender tint.
- `mouthStill`, `mouthClip`: their own prompts for the mouth close-up, when
  the usual tongue close-up isn't the point (Shiv's is the hotdog).

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
- **Environments and sound hits:** ElevenLabs sound effects on fal, $0.002 a
  second (a few cents an episode, once).

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
