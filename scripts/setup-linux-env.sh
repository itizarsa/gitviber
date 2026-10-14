#!/bin/sh
# Sets up a Debian/Ubuntu machine (or a cloud container) to build, test and drive GitViber
# headless: WebKitGTK for Tauri, plus Xvfb, xdotool, ImageMagick and ffmpeg for screenshots and
# video of the real window (.claude/skills/drive-gitviber/lx.sh).
set -e
cd "$(dirname "$0")/.."
SUDO=$([ "$(id -u)" = 0 ] && echo "" || echo sudo)
$SUDO apt-get update -qq
DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev \
  patchelf xvfb xdotool imagemagick ffmpeg
pnpm install --frozen-lockfile
