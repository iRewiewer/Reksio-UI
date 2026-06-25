# Reksio UI

Self-hosted browser launcher for [ReksioEngine](https://github.com/ReksioEngine/ReksioEngine).

The app builds the current ReksioEngine web player into the Docker image, serves a launcher UI, and stores user-added ISO games in a persistent data volume. Bundled Polish GitHub games remain available, and custom local ISOs for other language ports can be uploaded from the browser.

## Run with Docker

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
```

On startup, the container prepares the mounted data directory so uploaded games can be written by the app.

## Add Custom ISO

1. Open the launcher.
2. Click the add button in the library header.
3. Keep `ISO upload` selected.
4. Choose or drop a `.iso` file, set the title/language, and upload.

The launcher stores the ISO locally and starts ReksioEngine with:

```text
/engine/?loader=iso-remote&source=/api/games/<game-id>/iso
```

The server supports HTTP Range requests so the engine can read the ISO without downloading the entire image up front.

## Add another GitHub source

Use the `GitHub source` tab and enter a source name from `ReksioEngine/GamesFiles`. The launcher starts those games with the engine's existing GitHub loader.

## Configuration

Environment variables:

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3030` | HTTP port inside the container |
| `REKSIO_DATA_DIR` | `/data` | Persistent metadata and uploaded ISO directory |
| `MAX_ISO_SIZE_BYTES` | `8589934592` | Upload limit, default 8 GB |

Build argument:

| Name | Default | Purpose |
| --- | --- | --- |
| `REKSIOENGINE_REF` | `master` | Git ref used to build `ReksioEngine` |

## Local development

Install dependencies and start the server:

```sh
npm install
npm start
```

Local development serves the launcher and APIs. The `/engine` route is populated by the Docker build from `ReksioEngine`; for full game playback outside Docker, copy or build the engine output into `public/engine`.
