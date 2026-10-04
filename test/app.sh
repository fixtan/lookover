#!/bin/sh
# test/app.sh — アプリ本体 (Tauri) を、画面のない Linux 上で起動して、Rust 側との連携を試験する
#
# 先に  npx tauri build --debug --no-bundle  でアプリを作っておく。
# 使い方: sh test/app.sh
# 結果は test/app-result.json、画面は test/app-shot.png に出る。
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/../src-tauri/target/debug/lookover"
WORK="$HERE/work-app"
OUT="$HERE/app-result.json"
rm -rf "$WORK" "$OUT"
cp -r "$HERE/files" "$WORK"

# 画面の代わり (Xvfb) と、アプリ同士の連絡路 (dbus) を用意して、その中で動かす
# (dbus や画面まわりの警告が大量に出るので、ログへ逃がす)
exec dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" sh -c '
  export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
  APP="$1"; WORK="$2"; OUT="$3"; HERE="$4"
  "$APP" "$WORK/img1.png" "--selftest=$OUT" > "$HERE/app-1.log" 2>&1 &
  PID=$!
  # 1 回目の結果 (phase 1) が出るまで待つ
  for i in $(seq 1 120); do grep -q "\"phase\": 1" "$OUT" 2>/dev/null && break; sleep 0.5; done
  (command -v import >/dev/null && import -window root "$HERE/app-shot.png") || (command -v xwd >/dev/null && xwd -root -silent > "$HERE/app-shot.xwd") || true
  # 2 つ目を起動する。起動せずに、1 つ目へパスを渡して終わるはず。
  START=$(date +%s)
  "$APP" "$WORK/pic.webp" > "$HERE/app-2.log" 2>&1 &
  PID2=$!
  for i in $(seq 1 40); do kill -0 $PID2 2>/dev/null || break; sleep 0.5; done
  if kill -0 $PID2 2>/dev/null; then echo "second: STILL RUNNING" > "$HERE/app-second.txt"; kill $PID2; else echo "second: exited in $(( $(date +%s) - START ))s" > "$HERE/app-second.txt"; fi
  for i in $(seq 1 60); do grep -q "\"phase\": 2" "$OUT" 2>/dev/null && break; sleep 0.5; done
  kill $PID 2>/dev/null || true
' sh "$APP" "$WORK" "$OUT" "$HERE" > "$HERE/app-session.log" 2>&1
