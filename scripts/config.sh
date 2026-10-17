# Shared settings for the scripts (sourced, not run). Any of these can be set in the environment or in config.env at
# the repo's root (copy config.example.env); the defaults put everything big under ~/.jevrunner.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ROOT/config.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/config.env"
  set +a
fi
JEVRUNNER_HOME="${JEVRUNNER_HOME:-$HOME/.jevrunner}"
VLLM_VENV="${VLLM_VENV:-$JEVRUNNER_HOME/vllm}"                      # Python env with vLLM 0.30.0
H2O_DIR="${H2O_DIR:-$JEVRUNNER_HOME/models/h2o-lightning-4b}"        # the model download (Hugging Face repo files)
H2O_REPO="${H2O_REPO:-h2oai/h2o-lightning-4b}"
H2O_PORT="${H2O_PORT:-8741}"                                         # the model's /v1/systemone (its shim)
LOGS="${LOGS:-$JEVRUNNER_HOME/logs}"
BACKEND="${BACKEND:-auto}"                                           # auto | vllm | llamacpp
# QUANT (llama.cpp only: Q8_0 | Q4_K_M | BF16) is read by scripts/llamacpp.py; unset, it serves the one setup installed
PY="$(command -v python3 || command -v python || true)"
mkdir -p "$JEVRUNNER_HOME" "$LOGS"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}
h2o_up() { curl -sf -m 2 "http://127.0.0.1:$H2O_PORT/health" > /dev/null 2>&1; }

# Which backend serves H2O: the one setup chose (saved in $JEVRUNNER_HOME/backend), else vLLM on Linux with an NVIDIA
# GPU of 15 GB or more (fastest, the model's own deployment), else llama.cpp (Windows, macOS, smaller or other GPUs, CPU).
choose_backend() {
  if [ "$BACKEND" != auto ]; then echo "$BACKEND"; return; fi
  if [ -f "$JEVRUNNER_HOME/backend" ]; then cat "$JEVRUNNER_HOME/backend"; return; fi
  local vram=0
  if [ "$(uname -s)" = Linux ] && command -v nvidia-smi > /dev/null; then
    vram="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2> /dev/null | head -1 | tr -dc 0-9)"
  fi
  if [ "${vram:-0}" -ge 15000 ]; then echo vllm; else echo llamacpp; fi
}
