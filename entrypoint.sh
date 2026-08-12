#!/bin/sh
set -e
mkdir -p "$DATA_DIR"
if [ ! -f "$DATA_DIR/db.json" ]; then
  cp db.json "$DATA_DIR/db.json"
  echo "[entrypoint] seeded db.json to $DATA_DIR"
fi
exec node index.js
