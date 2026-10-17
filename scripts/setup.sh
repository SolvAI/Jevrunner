#!/usr/bin/env bash
# One-time setup: the game's Node packages, a Python env with vLLM 0.30.0, and H2O Lightning 4B's weights (~9 GB).
# Each step is skipped when it is already done, so it is safe to run again. Settings: scripts/config.sh.
set -euo pipefail
source "$(dirname "$0")/config.sh"
cd "$ROOT"

say "Checking the machine"
command -v node > /dev/null || die "Node.js 22+ is needed (https://nodejs.org)"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 22 ] || die "Node.js 22+ is needed, found $(node -v)"
command -v nvidia-smi > /dev/null || die "an NVIDIA GPU with its driver is needed (nvidia-smi not found)"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | sed 's/^/    GPU: /'
command -v python3 > /dev/null || die "Python 3.10+ is needed"
python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || die "Python 3.10+ is needed, found $(python3 -V)"

say "1/3 Node packages"
npm install --no-audit --no-fund

say "2/3 vLLM 0.30.0 in $VLLM_VENV"
if [ -x "$VLLM_VENV/bin/vllm" ]; then
  echo "    already there"
else
  # the wheels H2O Lightning 4B's card names: vLLM 0.30.0 built for CUDA 12.9 (works on 12.x drivers too)
  PKGS=("vllm==0.30.0+cu129" "torchcodec==0.16.0+cu129" "huggingface_hub")
  INDEX=(--extra-index-url https://wheels.vllm.ai/0.30.0/cu129 --extra-index-url https://download.pytorch.org/whl/cu129)
  if command -v uv > /dev/null; then
    uv venv --python 3.12 "$VLLM_VENV"
    uv pip install --python "$VLLM_VENV/bin/python" "${PKGS[@]}" "${INDEX[@]}" --index-strategy unsafe-best-match
  else
    python3 -m venv "$VLLM_VENV"
    "$VLLM_VENV/bin/pip" install --upgrade pip
    "$VLLM_VENV/bin/pip" install "${PKGS[@]}" "${INDEX[@]}"
  fi
fi
"$VLLM_VENV/bin/python" -c 'import vllm, torch; print(f"    vLLM {vllm.__version__}, torch {torch.__version__}, CUDA available: {torch.cuda.is_available()}")'

say "3/3 $H2O_REPO in $H2O_DIR"
if [ -f "$H2O_DIR/model.safetensors" ] && [ -f "$H2O_DIR/serve.sh" ]; then
  echo "    already there"
else
  HF="$VLLM_VENV/bin/hf"
  [ -x "$HF" ] || "$VLLM_VENV/bin/python" -m pip install "huggingface_hub" > /dev/null
  "$HF" download "$H2O_REPO" --local-dir "$H2O_DIR" ${H2O_REVISION:+--revision "$H2O_REVISION"}
fi

say "Ready. Start everything with: scripts/run.sh"
