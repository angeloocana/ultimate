#!/bin/sh
# Run a lander check while holding the Mac-wide landing marker, so other projects' heavy.sh starts no new heavy job
# (Blender, exports, Xcode, emulators) until it ends. Running jobs finish; only new ones wait.
#   sh .ultimate/hold-heavy.sh <command…>
# The marker is $HEAVY_DIR/landing (~/.ultimate/heavy/landing); heavy.sh honours it while its mtime is under 20
# minutes old. This touches it every HOLD_REFRESH seconds (60) and removes it on exit, unless another holder still
# runs or someone else (another project's landing) touched it meanwhile. A killed holder leaves it to expire.
set -u
[ $# -gt 0 ] || { echo "usage: sh .ultimate/hold-heavy.sh <command…>" >&2; exit 2; }
dir=${HEAVY_DIR:-$HOME/.ultimate/heavy} refresh=${HOLD_REFRESH:-60}
holders="$dir/landing.holders" me="$dir/landing.holders/$$" last="$dir/landing.last"
mkdir -p "$holders" || exit 1
mtime() { stat -f %Fm "$dir/landing" 2>/dev/null; }
mark() {
  if [ -e "$me" ] && [ "$(mtime)" != "$(cat "$last" 2>/dev/null)" ]; then : > "$me.shared"; fi
  touch "$dir/landing" "$me" && mtime > "$last"
}
mark
( while sleep "$refresh" && kill -0 $$ 2>/dev/null; do mark; done ) </dev/null >/dev/null 2>&1 &
refresher=$!
release() {
  kill "$refresher" 2>/dev/null
  mark
  rm -f "$me"
  if [ -e "$me.shared" ]; then rm -f "$me.shared"; return; fi
  for other in "$holders"/*; do
    case $other in *.shared) continue ;; esac
    if [ -e "$other" ] && kill -0 "${other##*/}" 2>/dev/null; then return; fi
    rm -f "$other" "$other.shared"
  done
  rm -f "$dir/landing"
}
trap release EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
"$@"
