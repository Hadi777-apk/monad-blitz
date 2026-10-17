#!/usr/bin/env bash
# Fresh local chain -> deploy -> export ABIs/addresses -> end-to-end run. Needs foundry and node.
# anvil's first dev account (public, local only) pays for the deployment; its key comes from anvil's own startup banner.
set -euo pipefail
cd "$(dirname "$0")/.."

pkill -x anvil 2>/dev/null || true
sleep 1
anvil --silent --port 8545 &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
sleep 2

forge build >/dev/null
# --unlocked + --sender uses anvil's unlocked dev account 0, so no key is passed on the command line
SENDER=$(cast rpc eth_accounts --rpc-url http://127.0.0.1:8545 | tr -d '[]" ' | cut -d, -f1)
DIFFICULTY_BITS=${DIFFICULTY_BITS:-12} ROUND_LENGTH=${ROUND_LENGTH:-20} \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender "$SENDER" >/dev/null
node scripts/export-deployment.mjs 31337 >/dev/null
(cd web && [ -d node_modules ] || npm install --silent)
(cd web && perl -e 'alarm 120; exec @ARGV' node scripts/e2e.mjs)
