#!/usr/bin/env bash
# Deploys the vault to the local fork, funds test wallets, and writes web/.env.local.
#
#   scripts/local-setup.sh [your-wallet-address ...]
#
# Anvil's first default account (used by the dev wallet) is always funded.
# Every address passed gets 10 ETH and 1,000 USDC.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC=http://127.0.0.1:8545
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
DEPLOYER=$(cast rpc --rpc-url $RPC eth_accounts | tr -d '[]"' | cut -d, -f1)

cast chain-id --rpc-url $RPC >/dev/null || { echo "Start the fork first: scripts/local-fork.sh"; exit 1; }

echo "Deploying vault from $DEPLOYER…"
FEE_RECIPIENT="${FEE_RECIPIENT:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}" # anvil account 1
echo "Protocol fees go to $FEE_RECIPIENT"
OUT=$(cd contracts && FEE_RECIPIENT=$FEE_RECIPIENT forge script script/Deploy.s.sol --rpc-url $RPC --unlocked --sender "$DEPLOYER" --broadcast 2>&1)
VAULT=$(echo "$OUT" | awk '$1 == "ClaimCodeVault" {print $2}' | tail -1)
BLOCK=$(echo "$OUT" | awk '/deploy block/ {print $3}' | tail -1)
[ -n "$VAULT" ] || { echo "$OUT"; exit 1; }
echo "Vault: $VAULT (block $BLOCK)"

fund() {
  local who=$1
  # USDC (FiatTokenV2_2) keeps balances in the mapping at slot 9.
  local slot
  slot=$(cast index address "$who" 9)
  cast rpc --rpc-url $RPC anvil_setStorageAt $USDC "$slot" "$(cast to-uint256 1000000000)" >/dev/null
  cast rpc --rpc-url $RPC anvil_setBalance "$who" "$(cast to-hex 10000000000000000000)" >/dev/null
  echo "Funded $who: $(cast call --rpc-url $RPC $USDC 'balanceOf(address)(uint256)' "$who") USDC units, 10 ETH"
}

# Anvil's public test keys carry EIP-7702 delegations on mainnet; clear the dev account's
# so it behaves like a plain wallet (USDC permits fail for delegated accounts).
cast rpc --rpc-url $RPC anvil_setCode "$DEPLOYER" 0x >/dev/null
# The same for the dev relayer (anvil account 2), so ETH sent to it stays there.
RELAYER=$(cast rpc --rpc-url $RPC eth_accounts | tr -d '[]"' | cut -d, -f3)
cast rpc --rpc-url $RPC anvil_setCode "$RELAYER" 0x >/dev/null

fund "$DEPLOYER"
for a in "$@"; do fund "$a"; done

cat > web/.env.local <<ENV
VITE_CHAIN_ID=31337
VITE_RPC_URL=$RPC
VITE_VAULT=$VAULT
VITE_VAULT_DEPLOY_BLOCK=$BLOCK
VITE_DEV_WALLET=1
ENV
echo "Wrote web/.env.local. Run: cd web && npm run dev"
