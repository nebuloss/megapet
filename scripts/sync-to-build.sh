#!/usr/bin/env sh
#
# Mirror this source tree to a remote build host.
#
# Useful when your development machine should not accumulate build artifacts.
# Set BUILD_HOST to an ssh destination; there is no default, so the script
# cannot quietly copy your source somewhere you did not intend.
#
#   BUILD_HOST=user@buildbox ./scripts/sync-to-build.sh
#   ssh user@buildbox 'cd ~/build/megapet && make check && make build'
#
set -eu

if [ -z "${BUILD_HOST:-}" ]; then
  echo "BUILD_HOST is not set. Example:" >&2
  echo "  BUILD_HOST=user@buildbox $0" >&2
  exit 64
fi
DEST="${BUILD_DEST:-~/build/megapet}"

ssh "$BUILD_HOST" "mkdir -p $DEST"
rsync -az --delete \
  --exclude '.git/' --exclude 'node_modules/' --exclude 'dist/' \
  --exclude 'web/dist/' --exclude 'web/preview-dist/' --exclude '*.db*' \
  ./ "$BUILD_HOST:$DEST/"
echo "synced to $BUILD_HOST:$DEST"
