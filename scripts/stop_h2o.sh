#!/usr/bin/env bash
# Stops H2O Lightning 4B (its shim, and vLLM or llama-server), for example one left running with KEEP_H2O=1.
source "$(dirname "$0")/config.sh"
# patterns anchored on the program that runs, so a shell whose command line mentions these names is never matched
pkill -f "^[^ ]*python[0-9.]* [^ ]*llamacpp\.py serve" 2> /dev/null || true
pkill -f "^[^ ]*python[0-9.]* [^ ]*h2o_lightning_llamacpp\.py" 2> /dev/null || true
pkill -f "^[^ ]*llama-server -m [^ ]*h2o-lightning-4b" 2> /dev/null || true
pkill -f "^[^ ]*python[0-9.]* [^ ]*h2o_lightning_shim\.py" 2> /dev/null || true
pkill -f "^[^ ]*python[0-9.]* [^ ]*vllm serve .*h2o" 2> /dev/null || true
sleep 2
if h2o_up; then echo "H2O still answers on :$H2O_PORT"; else echo "H2O stopped"; fi
