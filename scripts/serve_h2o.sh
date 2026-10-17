#!/usr/bin/env bash
# H2O Lightning 4B as a System One endpoint on :$H2O_PORT: vLLM 0.30.0 plus the model's own shim, started by the
# model's own serve.sh (two-way reading by default; TWO_WAY=0 for one-way). Runs in the foreground; scripts/run.sh
# starts it in the background for you.
set -euo pipefail
source "$(dirname "$0")/config.sh"
[ -x "$VLLM_VENV/bin/vllm" ] || die "no vLLM at $VLLM_VENV: run scripts/setup.sh"
[ -f "$H2O_DIR/serve.sh" ] || die "no H2O Lightning 4B at $H2O_DIR: run scripts/setup.sh (or set H2O_DIR in config.env)"

# Downloads made before 2026-10-17 ship the label rows as label_rows.safetensors (newer ones: label_rows.lightning).
# vLLM loads every *.safetensors of a model folder that has no weights index, so it would also read
# label_rows.safetensors (the shim's readout rows, tensor "W") and stop on "no module or parameter named 'W'". vLLM
# gets a folder of links to the model's files without it; the shim still reads the label rows from the model folder.
LINKS="$JEVRUNNER_HOME/h2o-weights"
mkdir -p "$LINKS"
for f in "$H2O_DIR"/*; do
  name="$(basename "$f")"
  [ "$name" = label_rows.safetensors ] || ln -sfn "$f" "$LINKS/$name"
done
rm -f "$LINKS/label_rows.safetensors"

# Sized for game decisions (prompts of a few hundred tokens, a handful at a time), not for long documents: vLLM sizes
# its start-up profiling to the context and the batch, and at the model's defaults it wants ~22 GB. MAX_LEN 8192 and
# 32 requests at a time use ~14 GB on a 24 GB card (GPU_UTIL 0.6) and leave the rest for the browser drawing the game.
# On a smaller card, raise GPU_UTIL (e.g. 0.85 on 16 GB) and close other GPU-heavy apps. The shim needs MAX_LEN >= 4096.
export PATH="$VLLM_VENV/bin:$PATH"
export MODEL="$LINKS" PORT="$H2O_PORT" VLLM_PORT="${VLLM_PORT:-8000}" MAX_LEN="${MAX_LEN:-8192}" GPU_UTIL="${GPU_UTIL:-0.6}"
export VLLM_ARGS="--max-num-seqs ${MAX_SEQS:-32} ${VLLM_ARGS:-}"
exec bash "$H2O_DIR/serve.sh"
