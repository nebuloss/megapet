#!/usr/bin/env sh
#
# Verify that a published release matches what this source tree builds.
#
#   ./scripts/verify-release.sh v1.2.0
#
# Downloads the release archive for this platform, rebuilds from the
# checked-out tree, and compares the two byte for byte. A mismatch means the
# published artifact was not built from this source, which is the one question
# a signature cannot answer on its own.
#
# This only means anything because the build is reproducible: see GOFLAGS in
# the Makefile, where `-buildvcs=false` stops Go stamping the commit and the
# build time into the binary. Without it two builds of identical source differ
# whenever one has a `.git` directory and the other does not.
#
# Environment:
#   MEGAPET_BASE_URL  where to fetch archives from (default: GitHub releases)
set -eu

REPO="nebuloss/megapet"
VERSION="${1:-}"

die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
say()  { printf '%s\n' "$*"; }
info() { printf '  %s\n' "$*"; }

[ -n "$VERSION" ] || die "usage: $0 <tag>, e.g. $0 v1.2.0"

for tool in curl tar sha256sum go make; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
done

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$(uname -m)" in
  x86_64|amd64)  arch="amd64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

ARCHIVE="megapet_${VERSION}_${os}_${arch}.tar.gz"
BASE="${MEGAPET_BASE_URL:-https://github.com/$REPO/releases/download/$VERSION}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

say "Verifying $VERSION for $os/$arch"

info "downloading $ARCHIVE"
curl -fsSL "$BASE/$ARCHIVE" -o "$work/archive.tar.gz" ||
  die "could not download $ARCHIVE"
tar xzf "$work/archive.tar.gz" -C "$work"
published="$(find "$work" -name megapetd -type f | head -n1)"
[ -n "$published" ] || die "no megapetd in the archive"

# The frontend is embedded, so it has to be rebuilt too: a binary built
# without it differs from the release in the way that matters most.
info "rebuilding from source"
make build VERSION="$VERSION" >/dev/null 2>&1 || die "build failed"

a="$(sha256sum "$published" | cut -d' ' -f1)"
b="$(sha256sum dist/megapetd | cut -d' ' -f1)"

say
info "published: $a"
info "rebuilt  : $b"
say

if [ "$a" = "$b" ]; then
  say "Match: $VERSION was built from this source."
  exit 0
fi

say "MISMATCH: the published binary does not match this source."
say
say "Worth investigating rather than ignoring. Likely causes, in the order"
say "worth checking:"
say
say "  - the tree is not at $VERSION      (git checkout $VERSION)"
say "  - uncommitted local changes        (git status)"
say "  - a different Go toolchain         (go version -m on each binary)"
exit 1
