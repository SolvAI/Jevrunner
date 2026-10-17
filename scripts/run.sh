#!/usr/bin/env bash
# Starts everything: H2O Lightning 4B (unless it is already up), then the game at http://localhost:5175.
# Ctrl-C stops the game and the model this script started (KEEP_H2O=1 leaves the model running for next time).
# With DECIDE_URL set (another System One endpoint, local or hosted), only the game starts.
set -euo pipefail
source "$(dirname "$0")/config.sh"
cd "$ROOT"
[ -d node_modules ] || die "run scripts/setup.sh first"

H2O_PID=""
cleanup() {
  if [ -n "$H2O_PID" ] && [ "${KEEP_H2O:-0}" != 1 ]; then
    say "Stopping H2O"
    kill "$H2O_PID" 2> /dev/null || true
    wait "$H2O_PID" 2> /dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ -n "${DECIDE_URL:-}" ]; then
  say "Using the model at $DECIDE_URL"
elif h2o_up; then
  say "H2O is already running on :$H2O_PORT"
else
  backend="$(choose_backend)"
  if [ "$backend" = llamacpp ]; then
    say "Starting H2O Lightning 4B on llama.cpp (about a minute)"
    say "Its log: $LOGS/h2o.log"
    "$PY" "$ROOT/scripts/llamacpp.py" serve > "$LOGS/h2o.log" 2>&1 &
  else
    say "Starting H2O Lightning 4B on vLLM (the first start compiles kernels: a few minutes; later starts ~1 minute)"
    say "Its log: $LOGS/h2o.log"
    "$ROOT/scripts/serve_h2o.sh" > "$LOGS/h2o.log" 2>&1 &
  fi
  H2O_PID=$!
  started=$(date +%s)
  until grep -q "ready on" "$LOGS/h2o.log" 2> /dev/null; do
    if ! kill -0 "$H2O_PID" 2> /dev/null; then
      tail -n 25 "$LOGS/h2o.log" >&2
      die "H2O stopped while starting (the end of its log is above; see Troubleshooting in the README)"
    fi
    printf '\r    waiting for H2O... %ss ' "$(($(date +%s) - started))"
    sleep 3
  done
  printf '\n'
  say "H2O is ready on :$H2O_PORT"
fi

say "The game: http://localhost:${GAME_PORT:-5175} (press LET ${MODEL_LABEL:-H2O} RUN)"
npm run dev -- ${OPEN:+--open}
