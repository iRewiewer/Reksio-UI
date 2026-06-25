#!/bin/sh
set -eu

DATA_DIR="${REKSIO_DATA_DIR:-/data}"

mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
    if chown -R node:node "$DATA_DIR" 2>/dev/null; then
        exec su-exec node "$@"
    fi

    echo "Warning: could not change ownership of $DATA_DIR; running as root so the data volume remains writable." >&2
fi

exec "$@"
