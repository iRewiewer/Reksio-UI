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
