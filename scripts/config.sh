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
mkdir -p "$JEVRUNNER_HOME" "$LOGS"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}
h2o_up() { curl -sf -m 2 "http://127.0.0.1:$H2O_PORT/health" > /dev/null 2>&1; }
