# Reksio UI

Self-hosted browser launcher for a local ReksioEngine checkout.

The app builds the local `./ReksioEngine` web player into the Docker image, serves a launcher UI, and stores user-added ISO games in a persistent data volume. Custom local ISOs for Romanian, English, Turkish, Polish, and other language ports can be uploaded from the browser.

## Run with Docker

Place or clone the engine source at:

```text
ReksioEngine/
  package.json
  yarn.lock
  src/
```

Then build and run:

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
  logs/
    <session-id>.ndjson
```

On startup, the container prepares the mounted data directory so uploaded games can be written by the app.

## Add Custom ISO

1. Open the launcher.
2. Click the add button in the library header.
3. Choose or drop a `.iso` file.
4. Set the title/language fields and upload.

The launcher stores the ISO locally and starts ReksioEngine with:

```text
/engine/?loader=iso-remote&source=/api/games/<game-id>/iso
```

The server supports HTTP Range requests so the engine can read the ISO without downloading the entire image up front.

## Local Working Files

`./ReksioEngine` and `./ISOs` are intentionally ignored by the UI repository. The engine checkout is a local development dependency, and the ISO folder is for private disc images used while testing compatibility.

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
| `MAX_ISO_SIZE_BYTES` | `8589934592` | Upload limit, default 8 GB |

## Local Development

Install dependencies and start the launcher server:

```sh
npm install
npm start
```

Local development serves the launcher and APIs. The `/engine` route is populated by the Docker build from `./ReksioEngine`; for full game playback outside Docker, build the engine and copy its app output into `public/engine`.
