#!/usr/bin/env bash
# Stops H2O Lightning 4B (its shim and vLLM), for example one left running with KEEP_H2O=1.
source "$(dirname "$0")/config.sh"
pkill -f "h2o_lightning_shim.py" 2> /dev/null || true
pkill -f "vllm serve .*h2o" 2> /dev/null || true
sleep 2
if h2o_up; then echo "H2O still answers on :$H2O_PORT"; else echo "H2O stopped"; fi
