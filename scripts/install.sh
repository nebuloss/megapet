#!/bin/sh
#
# Megapet installer.
#
#   curl -fsSL https://raw.githubusercontent.com/nebuloss/megapet/main/scripts/install.sh | sh
#
# Downloads the release archive for this machine, verifies its SHA-256 against
# the published checksum file, and installs the binary. Nothing is written
# outside PREFIX unless --systemd is given.
#
# Environment:
#   MEGAPET_VERSION   tag to install, e.g. v1.0.0   (default: latest release)
#   PREFIX            install prefix                (default: /usr/local)
#   MEGAPET_BASE_URL  where to fetch archives from  (default: GitHub releases)
#                     Useful for an internal mirror, and for testing.
#
# Flags:
#   --systemd         also create the service user, config and unit
#   --uninstall       remove what this script installed
#   --version <tag>   same as MEGAPET_VERSION
#   --prefix <path>   same as PREFIX
#
set -eu

REPO="nebuloss/megapet"
BINARY="megapetd"
PREFIX="${PREFIX:-/usr/local}"
VERSION="${MEGAPET_VERSION:-}"
WITH_SYSTEMD=0
UNINSTALL=0

CONFIG_DIR="/etc/megapet"
STATE_DIR="/var/lib/megapet"
UNIT="/etc/systemd/system/megapet.service"
SERVICE_USER="megapet"

TMPDIR_CREATED=""
cleanup() { [ -n "$TMPDIR_CREATED" ] && rm -rf "$TMPDIR_CREATED"; }
trap cleanup EXIT INT TERM

say()  { printf '%s\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"; }

# --------------------------------------------------------------- arguments --

while [ $# -gt 0 ]; do
  case "$1" in
    --systemd)   WITH_SYSTEMD=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --version)   shift; [ $# -gt 0 ] || die "--version needs a tag"; VERSION="$1" ;;
    --prefix)    shift; [ $# -gt 0 ] || die "--prefix needs a path"; PREFIX="$1" ;;
    -h|--help)
      sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

# ------------------------------------------------------------- privileges --

# Escalate only where it is actually needed. Installing into a prefix the user
# already owns must not touch sudo, or the files end up owned by root and the
# user cannot clean them up afterwards.
writable() {
  target="$1"
  while [ ! -e "$target" ]; do target="$(dirname "$target")"; done
  [ -w "$target" ]
}

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif writable "$PREFIX/bin"; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  die "$PREFIX is not writable and sudo is unavailable; re-run with --prefix \"\$HOME/.local\""
fi

# The systemd parts always write to /etc and /var, so they always need root.
if [ "$(id -u)" -eq 0 ]; then
  ROOT=""
elif command -v sudo >/dev/null 2>&1; then
  ROOT="sudo"
else
  ROOT=""
fi
require_root() {
  [ "$(id -u)" -eq 0 ] || [ -n "$ROOT" ] ||
    die "$1 needs root, and sudo is unavailable"
}

# ------------------------------------------------------------- uninstall --

if [ "$UNINSTALL" -eq 1 ]; then
  say "Removing megapet"
  if [ -f "$UNIT" ]; then
    require_root "removing the systemd unit"
    $ROOT systemctl disable --now megapet 2>/dev/null || true
    $ROOT rm -f "$UNIT"
    $ROOT systemctl daemon-reload 2>/dev/null || true
    info "removed $UNIT"
  fi
  $SUDO rm -f "$PREFIX/bin/$BINARY" && info "removed $PREFIX/bin/$BINARY"
  say
  say "Left in place, in case you want the data:"
  say "  $CONFIG_DIR   $STATE_DIR   user '$SERVICE_USER'"
  exit 0
fi

# ------------------------------------------------------ platform detection --

need uname
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in
  linux|darwin|freebsd) : ;;
  *) die "unsupported operating system: $os" ;;
esac

machine="$(uname -m)"
case "$machine" in
  x86_64|amd64)   arch="amd64" ;;
  aarch64|arm64)  arch="arm64" ;;
  armv7l|armv7|armhf) arch="arm" ;;
  *) die "unsupported architecture: $machine" ;;
esac

# Only linux/amd64+arm64+arm, darwin/amd64+arm64 and freebsd/amd64 are built.
case "$os/$arch" in
  linux/amd64|linux/arm64|linux/arm|darwin/amd64|darwin/arm64|freebsd/amd64) : ;;
  *) die "no release is published for $os/$arch" ;;
esac

# --------------------------------------------------------------- downloads --

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
  fetch_stdout() { curl -fsSL "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
  fetch_stdout() { wget -qO- "$1"; }
else
  die "curl or wget is required"
fi
need tar

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "sha256sum or shasum is required to verify the download"
fi

if [ -z "$VERSION" ] && [ -n "${MEGAPET_BASE_URL:-}" ]; then
  die "MEGAPET_BASE_URL needs an explicit --version"
fi

if [ -z "$VERSION" ]; then
  say "Resolving the latest release"
  VERSION="$(
    fetch_stdout "https://api.github.com/repos/$REPO/releases/latest" |
      sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
  )"
  [ -n "$VERSION" ] || die "could not determine the latest release; pass --version"
fi

ARCHIVE="megapet_${VERSION}_${os}_${arch}.tar.gz"
CHECKSUMS="megapet_${VERSION}_checksums.txt"
BASE="${MEGAPET_BASE_URL:-https://github.com/$REPO/releases/download/$VERSION}"

TMPDIR_CREATED="$(mktemp -d)"
say "Installing megapet $VERSION for $os/$arch"

info "downloading $ARCHIVE"
fetch "$BASE/$ARCHIVE" "$TMPDIR_CREATED/$ARCHIVE" ||
  die "download failed — is $VERSION a published release?"

info "downloading checksums"
fetch "$BASE/$CHECKSUMS" "$TMPDIR_CREATED/$CHECKSUMS" || die "checksum file not found"

# Verifying is the point of downloading the checksum file, so a mismatch is
# fatal and deliberately loud.
expected="$(grep " $ARCHIVE\$" "$TMPDIR_CREATED/$CHECKSUMS" | cut -d' ' -f1)"
[ -n "$expected" ] || die "$ARCHIVE is not listed in $CHECKSUMS"
actual="$(sha256 "$TMPDIR_CREATED/$ARCHIVE")"
if [ "$expected" != "$actual" ]; then
  die "checksum mismatch for $ARCHIVE
  expected $expected
  got      $actual"
fi
info "checksum verified"

tar -xzf "$TMPDIR_CREATED/$ARCHIVE" -C "$TMPDIR_CREATED"
STAGE="$TMPDIR_CREATED/megapet_${VERSION}_${os}_${arch}"
[ -f "$STAGE/$BINARY" ] || die "the archive did not contain $BINARY"

# ----------------------------------------------------------------- install --

$SUDO mkdir -p "$PREFIX/bin"
$SUDO install -m 0755 "$STAGE/$BINARY" "$PREFIX/bin/$BINARY"
info "installed $PREFIX/bin/$BINARY"

if [ "$WITH_SYSTEMD" -eq 1 ]; then
  command -v systemctl >/dev/null 2>&1 || die "--systemd was given but systemctl is not available"
  require_root "--systemd"

  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    $ROOT useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
    info "created the '$SERVICE_USER' user"
  fi

  $ROOT mkdir -p "$CONFIG_DIR" "$STATE_DIR"
  $ROOT chown "$SERVICE_USER:$SERVICE_USER" "$STATE_DIR"

  # Never clobber a config that is already there.
  if [ ! -f "$CONFIG_DIR/megapet.json" ]; then
    $ROOT install -m 0644 "$STAGE/megapet.example.json" "$CONFIG_DIR/megapet.json"
    info "wrote $CONFIG_DIR/megapet.json"
  else
    info "kept the existing $CONFIG_DIR/megapet.json"
  fi

  $ROOT install -m 0644 "$STAGE/deploy/megapet.service" "$UNIT"
  $ROOT systemctl daemon-reload
  $ROOT systemctl enable --now megapet
  info "enabled and started the megapet service"
fi

# ------------------------------------------------------------- next steps --

installed_version="$("$PREFIX/bin/$BINARY" -version 2>/dev/null || echo "$VERSION")"
say
say "Done — $installed_version"
say
if [ "$WITH_SYSTEMD" -eq 1 ]; then
  say "  systemctl status megapet"
  say "  edit $CONFIG_DIR/megapet.json, then: systemctl restart megapet"
else
  say "  $BINARY                 # listens on :8080"
  say "  $BINARY -dump-config    # show the effective configuration"
  say
  say "To run it as a service instead, re-run this script with --systemd."
fi
case ":$PATH:" in
  *":$PREFIX/bin:"*) : ;;
  *) say; say "Note: $PREFIX/bin is not on your PATH." ;;
esac
