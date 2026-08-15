#!/bin/sh
set -e
mkdir -p "$DATA_DIR"
if [ ! -f "$DATA_DIR/db.json" ] || [ "$SEED_DB_FORCE" = "1" ]; then
  cp db.json "$DATA_DIR/db.json"
  echo "[entrypoint] seeded db.json to $DATA_DIR"
fi
exec node index.js
