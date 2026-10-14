#!/usr/bin/env bash
# Linux driver for the GitViber dev app on Xvfb :99. Usage:
#   lx.sh js '<function body>'   run JS in the page via dev_bridge (prelude helpers in scope)
#   lx.sh shot <name>            screenshot of the whole X display -> $UI_DIR/<name>.png
#   lx.sh rec-start <name> / rec-stop   record display to <name>.mp4
#   lx.sh click X Y | key <xdotool-key>
set -e
UI_DIR=${UI_DIR:?set UI_DIR to a scratch folder}
PRELUDE=$(dirname "$0")/prelude.js
export DISPLAY=${DISPLAY:-:99}
case "$1" in
  js) { cat $PRELUDE; printf '%s\n' "$2"; } | python3 -c '
import socket, sys
s = socket.create_connection(("127.0.0.1", 1520), timeout=30)
s.sendall(sys.stdin.buffer.read()); s.shutdown(socket.SHUT_WR)
print(b"".join(iter(lambda: s.recv(65536), b"")).decode())';;
  shot) import -window root "$UI_DIR/$2.png" && echo "$UI_DIR/$2.png";;
  rec-start) nohup ffmpeg -y -loglevel error -f x11grab -framerate 15 -video_size 1480x920 -i $DISPLAY -c:v libx264 -pix_fmt yuv420p -preset veryfast "$UI_DIR/$2.mp4" > "$UI_DIR/rec.log" 2>&1 & echo $! > "$UI_DIR/rec.pid";;
  rec-stop) kill -INT $(cat "$UI_DIR/rec.pid"); sleep 2;;
  click) xdotool mousemove "$2" "$3" click 1;;
  key) xdotool key "$2";;
esac
