# Reksio UI

Self-hosted browser launcher for a vendored ReksioEngine build.

The app builds the bundled `./ReksioEngine` web player into the Docker image, serves a launcher UI, and stores user-added ISO games in a persistent data volume. Custom local ISOs for Romanian, English, Turkish, Polish, and other language ports can be uploaded from the browser.

## Run with Docker

The engine source is included in:

```text
ReksioEngine/
  package.json
  yarn.lock
  src/
```

Build and run:

```sh
docker compose up --build
```

Open http://localhost:3030.

Uploaded games and metadata are stored in `./data` on the host:

```text
data/
  games.json
  games/
    <game-id>/game.iso
    <game-id>/files/
  logs/
    <session-id>.ndjson
    <session-id>-export-<timestamp>/
      console.ndjson
      screenshot.png
```

On startup, the container prepares the mounted data directory so uploaded games can be written by the app.

## Add Custom ISO

1. Open the launcher.
2. Click the add button in the library header.
3. Choose or drop a `.iso` file.
4. Set the title/language fields and upload.

The launcher stores the ISO locally, extracts it on the server during upload, and starts ReksioEngine with an extracted asset listing:

```text
/engine/?loader=listingjson&source=/api/games/<game-id>/listing
```

The raw ISO endpoint is still available at `/api/games/<game-id>/iso` for diagnostics. Docker includes `7zip` for extraction; local development needs `7z` on `PATH`, or `REKSIO_EXTRACTOR` set to a compatible executable. Existing entries uploaded before this behavior should be re-uploaded so their extracted `files/` folder is created.

## Snapshots

Snapshots normally use **scene-entry checkpoints**, not exact mid-animation save states. They capture the scene name, persistent global values, save JSON, and IndexedDB files from entry into the current scene. Restoring rebuilds the engine inside the existing iframe and returns directly to that scene. A minigame restarts from its entry state; earlier scenes do not need to be replayed.

To preserve puzzle changes made inside a room, leave and re-enter that room before creating a checkpoint. For example, Magicienii teleport parts fitted after entering the yard are included only after a yard round trip.

Nemo's `ARCADE` scene is an exception: several districts share that scene, so new snapshots capture its current persisted slot files and global values after the active script tick settles. These are labeled **Saved progress** and restore saved district, position, inventory and puzzle flags, rather than transient animation or dialogue state. Older scene-entry snapshots retain their original behavior.

Old snapshots remain available as **Legacy save files**. They restore saved files only and may require the game's own Load menu. They cannot be converted into a checkpoint after the fact.

Snapshots are stored in the browser's IndexedDB under the current host/origin. They survive Docker rebuilds and app restarts, but they are local to the browser profile.

Each game now has an isolated engine filesystem. Existing shared filesystem data is copied once for Magicienii without deleting the old database.

Magicienii checkpoint restores clear transient page-turn graphics before entering the saved scene, preventing a stale page corner from covering the yard or intercepting clicks. The Trace toggle updates the running player without reloading and captures its current diagnostic state; it can be switched off immediately after reproduction.

## Compatibility Profiles

Pirates uses the `default` profile, which preserves the existing engine behavior. The launcher selects `magicienii`, `ozn`, `nemo`, or `timpului` from the game title. New compatibility behavior is gated in `ReksioEngine/src/engine/compat.ts`; do not enable a new fix globally without regression testing Pirates.

Current compatibility work includes JPEG backgrounds, newer script local variables and return values, Nemo packed SND archives and cutscene tables, and subsection completion callbacks for Time Machine's intro. Magicienii and Time Machine load the original SEKAI v4 navigation graphs instead of using straight-line movement. Routes honor directional links, waypoint groups and scripted exact endpoints, using `ngraph.path` for graph search. All 139 local SEKAI files parsed successfully (126 navigation graphs, 69,024 waypoints); endpoint behavior was checked against the isolated native path routine. Full WORLD physics, acceleration and scrolling-camera behavior are not implemented.

Magicienii's white-room entrance, hidden door, mirror room, arrival cutscene and full teleport-building puzzle have been verified. Chicken-yard and workshop passages, all required pickups, inventory selection, sixteen fitted components and final trousers activation have been exercised. A checkpoint with sixteen fitted components and the final item restores correctly. Activation from that restored checkpoint plays both travel cutscenes and reaches the office's opening dialogue. Office walking, multiple director topics and chained answers, the director's offer, the gatekeeper code panel, and entry into the university main hall have been verified. A 57-waypoint route down the hall's staircase completed successfully. The lower corridor passage, classroom door, Guldryk dialogue, practice dummy, and first spell lesson entry now work. Its corrected background checkpoint restores directly into the lesson. Repeated drawing strokes reached the original 100-movement requirement and advanced the voiced tutorial without an engine halt. Spell recognition and the first lesson's three-cast completion pass a script-level diagnostic; the full browser lesson and subsequent chapters remain unverified. The ten-slot inventory fills correctly and refuses further pickups until parts are used. The hall reports a missing `HOLGLOWNY/WST0.ARR` intro file, but walking continues. A small white strip at the top of the chicken yard remains: its 624-pixel background has a signed Y offset of -24 that the background renderer does not yet apply.

Magicienii's missing inventory opacity query is implemented only for this profile. Queued mouse clicks retain their own coordinates through asynchronous script callbacks, including double-clicks, and inventory hit tests refresh moved sprites before consulting their pixel masks. Clearing a database also resets its selected row only for this profile; the cursor factory previously retained an out-of-range row when loading the smaller office table and paused class ticking. Its database `FIND` also selects the matched row, as required by direct cursor reads in branching dialogue; unsuccessful searches leave the previous selection intact. Other profiles retain their existing lookup behavior. It also supports asynchronous numeric database lookup, NULL entrance-name lookup, named sound objects in dialogue sequences, fractional direction calculations, and named cutscene subsection callbacks. Checkpoints are available for the mirror room, chicken yard, assembly yard, office, director dialogue and offer, gatekeeper panel, university hall, lower corridor, classroom and first spell lesson. `ReksioEngine/src/engine/patches/magicienii.ts` repairs a misspelled idle voice reference, clears transient page overlays when restoring a checkpoint, and removes an unused editor-placeholder branch from the dialogue's `blank.seq`. That branch references an absent animation and otherwise prevents the answer sequence from initializing; its real `GADABLANK` branch is preserved.

Its spell lesson also needs profile-gated group `GETSIZE` and `REMOVEALL` operations; forwarding these calls to the actors previously halted entry. Cropped canvas saves now write the actual scaled pixel dimensions, fixing the black captured-room background. Scripted mouse warps use subsequent physical pointer deltas rather than accumulating absolute positions, anchor on real input rather than an uninitialized renderer pointer, and rebase when returning from launcher controls. A patch limited to `magic/magic.cnv` replaces the drawing wand's absent `PLAY` reference and numeric frame-count query with its actual `CZARUJE` event. Trace output includes tutorial phase, movement count, cursor position and spell readiness. These gameplay changes remain disabled for Pirates and the other compatibility profiles.

Magicienii's counted-loop `BREAK` propagates to the calling behaviour, matching the original `PIKLIB8.dll` loop control flow. Previously, recognition charged the wand but then reset the selected spell to `-1` after leaving its search loop. `ONE_BREAK` still skips only the current iteration; other game profiles retain their existing loop semantics. The same scene-specific patch calls the effect-sound behaviour with `RUN` instead of its unsupported `PLAY` method.

Run the optional local spell diagnostic against an extracted Magicienii `files/` directory:

```sh
node ReksioEngine/tests/verify-magicienii.cjs "path/to/extracted/files"
```

It loads the original game script and real interpreter, callback, value, mouse and wand-animation logic. It checks 12 exact spell shapes, 12 shapes rotated by 25 degrees, 12 rejected shapes rotated by 50 degrees, charging, three pudding casts, target defeat, completion callbacks, the learned flag and effect reset. Renderer output, sound playback and target hit testing are mocked; this is not a browser playthrough. No game assets are bundled with the diagnostic.

Time Machine's title menu, first two story cutscenes, first yard and chicken yard now run. Curator dialogue, the yard exit, umbrella pickup and inventory display have been verified. Both characters' chicken-yard movement and umbrella pickup were rechecked using SEKAI routes, including clicks clamped to walkable waypoints. Later scenes and physics minigames remain unverified. Its JPEG alpha masks use the actual decompressed view length, and sequences can chain from their completion callbacks. Game-specific repairs in `ReksioEngine/src/engine/patches/timpului.ts` keep music filenames out of an integer variable and initialize the dynamically loaded character with a valid placeholder.

Nemo reaches Paris after both opening story sequences. Paris checkpoints restore directly, dialogue advances through successive database rows, and the scripted grid pathfinder supports walking. The first-to-second district transition, lamplighter interaction, lamp-lighter pickup, inventory expansion and item selection have been verified. Its profile handles trailing ANN frame extensions, reusable packed audio buffers, dynamic walker placeholders, class constructor names, invisible hotspot transforms, class-owned player sprites, rectangular button priorities and inventory frame stepping. It reloads the selected save-slot database after checkpoint restoration. New arcade checkpoints preserve in-scene saved progress; restoring district two with the lamp-lighter held has been verified in the browser. All 977 ANN files in the local Nemo extraction were decoded successfully during the format audit. Later puzzles and chapters are not yet verified.

OZN's intro, menu, first conversation and transition to the next yard have been verified. Its digging minigame now has a profile-gated MATRIX simulation in `ReksioEngine/src/engine/compat/oznMatrix.ts`, covering falling and rolling stones, gate checks, enemy wall following, and queued movement callbacks. Its image clones are added to the renderer with their original priorities. Digging movement, dynamite pickup, blasting wall tiles, restarting the board and restoring its scene-entry checkpoint have been verified. The simulation was compared against 300 isolated original-DLL ticks and 18,000 enemy direction decisions. The replacement runs as TypeScript; no native DLL is executed. The full minigame and later stages remain unverified. Three malformed intro callbacks are repaired only for that game's opening script in `ReksioEngine/src/engine/patches/ozn.ts`. Pirates' opening and shipwreck interaction were smoke-tested on the default profile; its existing compatibility behavior remains the baseline.

Newer-script compatibility includes typed callback arguments, struct-field writes, sequential database searches, numeric dynamic callbacks, computed handler names, and clone cleanup. These changes are disabled for Pirates. Named sequence subsections fire only their explicit callbacks; single-entry sequences finish once. Player teardown also releases old object scopes and input listeners when restoring checkpoints. Trace logs include changed hotspot results and database search values, matched rows and cursor positions, and suppress repeated stationary mouse queries. Sound playback logs identify the actual dynamically loaded file rather than its initial placeholder; each playback retains its filename even if the sound object is subsequently reloaded.

For local debugging, append `&scene=ARCADE&sceneObject=BIALO` to a Magicienii launcher URL that already contains `?game=<game-id>`. This initializes the persistent game objects and enters the white room; use `LUSTRO` for the mirror room. These parameters can write the game's normal save files, so create a checkpoint before testing. Remove both parameters to return to normal startup. They are not applied when selecting a different game.

Run focused compatibility regression tests with `npm test --prefix ReksioEngine`, plus `npm run check` and `npm run build --prefix ReksioEngine`. Then run `.\rebuild.bat` for the Docker deployment. Reaching a title or menu is not evidence that an entire game is playable; gameplay still needs scene-by-scene verification.

## Local Working Files

`./ReksioEngine` is vendored source and is required by the Docker build. Its local `.git`, `.github`, `node_modules`, and `dist` folders are ignored.

`./ISOs` is intentionally ignored by the UI repository. Use it for private disc images while testing compatibility.

Current local ISO focus:

1. `Reksio si Magicienii.iso`
2. `Reksio si Comoara Piratilor.iso`
3. `Reksio si OZN-ul.iso`
4. `Reksio si Masina Timpului.iso`
5. `Reksio si Capitanul Nemo.iso`

Release order reference:

1. `Piratilor`
2. `OZN-ul`
3. `Magicienii`
4. `Masina Timpului`
5. `Capitanul Nemo`

## Configuration

Environment variables:

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3030` | HTTP port inside the container |
| `REKSIO_DATA_DIR` | `/data` | Persistent metadata, logs, and uploaded ISO directory |
| `REKSIO_ENGINE_DIR` | auto-detected | Override the directory served at `/engine` |
| `REKSIO_EXTRACTOR` | `7z` | ISO extraction command used for custom uploaded games |
| `MAX_ISO_SIZE_BYTES` | `8589934592` | Upload limit, default 8 GB |

## Local Development

Install dependencies and start the launcher server:

```sh
npm install
npm start
```

Local development serves the launcher and APIs. The `/engine` route uses `REKSIO_ENGINE_DIR` when set, then `ReksioEngine/dist/app` when it exists, then the Docker/static fallback at `public/engine`.

For local game playback outside Docker, build the engine first:

```sh
cd ReksioEngine
corepack yarn build
cd ..
npm start
```

When `ReksioEngine/dist/app` exists, the launcher serves it at `/engine`. Docker still serves the image-built bundle from `public/engine`.
