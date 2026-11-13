#!/usr/bin/env bash
# Deploys the vault to Sepolia and prints the values the site needs.
#
# One-time, so the deployer key is never typed into a command or a file in this repo:
#   cast wallet import ens-codes-deployer --interactive
# (paste the key of a wallet holding a little Sepolia ETH; it is stored encrypted under ~/.foundry)
#
# Then:
#   FEE_RECIPIENT=0x... scripts/deploy-sepolia.sh
#
# Optional: OWNER (defaults to the deployer), MAX_CODE_AMOUNT (USDC units, default 500e6),
# ACCOUNT (keystore name, default ens-codes-deployer), SEPOLIA_RPC_URL.
set -euo pipefail
cd "$(dirname "$0")/../contracts"

: "${FEE_RECIPIENT:?Set FEE_RECIPIENT to the address that should receive the 0.05 USDC fees}"
RPC="${SEPOLIA_RPC_URL:-https://sepolia.gateway.tenderly.co}"
ACCOUNT="${ACCOUNT:-ens-codes-deployer}"

[ "$(cast chain-id --rpc-url "$RPC")" = "11155111" ] || { echo "That RPC is not Sepolia."; exit 1; }
SENDER=$(cast wallet address --account "$ACCOUNT")
echo "Deploying from $SENDER (balance: $(cast balance "$SENDER" --rpc-url "$RPC" --ether) ETH)"
echo "Fees go to $FEE_RECIPIENT"

OUT=$(FEE_RECIPIENT=$FEE_RECIPIENT forge script script/Deploy.s.sol --rpc-url "$RPC" --account "$ACCOUNT" --sender "$SENDER" --broadcast 2>&1) || { echo "$OUT"; exit 1; }
VAULT=$(echo "$OUT" | awk '$1 == "ClaimCodeVault" {print $2}' | tail -1)
BLOCK=$(echo "$OUT" | awk '/deploy block/ {print $3}' | tail -1)
[ -n "$VAULT" ] || { echo "$OUT"; exit 1; }

cat <<ENV

Deployed. Set these in Vercel (Project → Settings → Environment Variables), then redeploy:

VITE_CHAIN_ID=11155111
VITE_RPC_URL=$RPC
VITE_VAULT=$VAULT
VITE_VAULT_DEPLOY_BLOCK=$BLOCK

https://sepolia.etherscan.io/address/$VAULT
ENV
