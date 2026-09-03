#!/usr/bin/env sh
# Mirror this source tree to the build host. Builds never run on dev-code.
set -eu
HOST="${BUILD_HOST:-guillaume@10.0.50.21}"
DEST="${BUILD_DEST:-~/build/speedtest}"
ssh "$HOST" "mkdir -p $DEST"
rsync -az --delete \
  --exclude '.git/' --exclude 'node_modules/' --exclude 'dist/' \
  --exclude 'web/dist/' --exclude '*.db*' \
  ./ "$HOST:$DEST/"
echo "synced to $HOST:$DEST"
