#!/bin/sh
# clippy for the macOS app from a Linux machine (a cloud container): `sh scripts/clippy-macos-from-linux.sh`.
# The app only builds for macOS, and Linux has no macOS C toolchain, so a stand-in compiler writes
# an empty object for each C file a build script compiles: clippy never links, so that's enough.
# Tests still need a Mac (CI runs them).
set -e
cd "$(dirname "$0")/../src-tauri"
rustup target add aarch64-apple-darwin >/dev/null
cc=$(mktemp -d)/cc
cat > "$cc" <<'CC'
#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -Fo*) out="${1#-Fo}" ;;
  esac
  shift
done
[ -n "$out" ] && : > "$out"
exit 0
CC
chmod +x "$cc"
CC_aarch64_apple_darwin="$cc" AR_aarch64_apple_darwin=ar \
  cargo clippy --target aarch64-apple-darwin --all-targets "$@" -- -D warnings
