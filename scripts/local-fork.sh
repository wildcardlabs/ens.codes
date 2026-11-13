#!/usr/bin/env bash
# Starts a local mainnet fork on http://127.0.0.1:8545 with chain id 31337.
#
# The fork stays pinned to its starting block, so the RPC must serve historical (archive) state.
# Uses MAINNET_RPC_URL if set. The default is drpc's free endpoint, which serves archive reads;
# publicnode does not (it returns "Archive requests require a personal token").
# Retries and a request cap keep a rate-limited free RPC from crashing anvil.
set -euo pipefail
RPC="${MAINNET_RPC_URL:-https://eth.drpc.org}"
exec anvil --fork-url "$RPC" --chain-id 31337 --port 8545 --block-time 2 \
  --retries 10 --fork-retry-backoff 1000 --compute-units-per-second 100
