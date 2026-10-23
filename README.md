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

New snapshots are **scene-entry checkpoints**, not exact mid-animation save states. They capture the scene name, persistent global values, save JSON, and IndexedDB files from entry into the current scene. Restoring rebuilds the engine inside the existing iframe and returns directly to that scene. A minigame restarts from its entry state; earlier scenes do not need to be replayed.

Old snapshots remain available as **Legacy save files**. They restore saved files only and may require the game's own Load menu. They cannot be converted into a checkpoint after the fact.

Snapshots are stored in the browser's IndexedDB under the current host/origin. They survive Docker rebuilds and app restarts, but they are local to the browser profile.

Each game now has an isolated engine filesystem. Existing shared filesystem data is copied once for Magicienii without deleting the old database.

## Compatibility Profiles

Pirates uses the `default` profile, which preserves the existing engine behavior. The launcher selects `magicienii`, `ozn`, `nemo`, or `timpului` from the game title. New compatibility behavior is gated in `ReksioEngine/src/engine/compat.ts`; do not enable a new fix globally without regression testing Pirates.

Current compatibility work includes JPEG backgrounds, newer script local variables and return values, Nemo packed SND archives and cutscene tables, and subsection completion callbacks for Time Machine's intro. Magicienii's WORLD pathing remains a limited straight-line implementation, not a complete physics or obstacle engine.

Magicienii's white-room entrance, hidden door and transition to the mirror room have been verified. Its profile also supports asynchronous numeric database lookup, NULL entrance-name lookup, named sound objects in dialogue sequences, and fractional direction calculations. A mirror-room checkpoint has been restored successfully without replaying the intro.

Time Machine's title menu, first two story cutscenes, and first yard now run. Characters are visible and respond to movement clicks, but obstacle-aware WORLD movement is still incomplete. Its JPEG alpha masks use the actual decompressed view length, and sequences can chain from their completion callbacks. Game-specific repairs in `ReksioEngine/src/engine/patches/timpului.ts` keep music filenames out of an integer variable and initialize the dynamically loaded character with a valid placeholder.

Nemo reaches Paris after both opening story sequences. A Paris scene-entry checkpoint restores directly, dialogue advances through successive database rows, and the scripted grid pathfinder supports walking. Its profile handles trailing ANN frame extensions, reusable packed audio buffers, dynamic walker placeholders, and reloading the selected save-slot database after checkpoint restoration. All 977 ANN files in the local Nemo extraction were decoded successfully during the format audit. Later puzzles and chapters are not yet verified.

OZN's intro, menu, first conversation and transition to the next yard have been verified. Three malformed intro callbacks are repaired only for that game's opening script in `ReksioEngine/src/engine/patches/ozn.ts`. Later minigames remain unverified. Pirates' opening and shipwreck interaction were smoke-tested on the default profile; its existing compatibility behavior remains the baseline.

Newer-script compatibility includes typed callback arguments, struct-field writes, sequential database searches, numeric dynamic callbacks, and clone cleanup. These changes are disabled for Pirates. Player teardown also releases old object scopes and input listeners when restoring checkpoints.

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
