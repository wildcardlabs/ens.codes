# ens.codes

Claim codes for ENS renewals. Buy a code with USDC, hand it to anyone, and they use it to renew any
`.eth` name. A code can only ever pay for ENS renewals.

Running on the Sepolia testnet at [ens.codes](https://ens.codes). The contract has not been
audited: don't use it with real funds.

## How it works

- **A code is a key.** Each code (`XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`) derives a private key. The vault
  only ever sees that key's address, and a redemption is authorised by the key's signature, so the
  code itself never goes onchain.
- **Buy.** One code, or up to 200 of the same value in one transaction. The buyer pays each code's
  value plus a flat 0.05 USDC fee. A whole purchase is stored as one record, with the codes
  committed as a Merkle root.
- **Redeem.** A code is spent once, on up to 5 names. Either every name renews or the code stays
  unused. Whatever a renewal doesn't spend goes back to the buyer in the same transaction, and
  nothing can be paid to whoever submits it.
- **No wallet needed to redeem.** The code signs the redemption in the browser and a relayer
  submits it and pays the network fee. A wallet works too.
- **Cancel.** Until a code is used its value is still the buyer's, who can cancel it at any time.
  Codes don't expire.
- **Recover.** Codes are derived from a signature by the buying wallet, so the buyer can reveal them
  again later. Nothing is stored on a server.

## Repository

| Path | What |
| --- | --- |
| `contracts/` | The vault (`src/ClaimCodeVault.sol`), its tests and deploy script. Foundry |
| `web/` | The site: landing page, buy, redeem and "My codes". React, Vite, viem |
| `api/` | Serverless functions: the relayer, which submits redemptions, and the owner's dashboard figures |
| `infra/` | CloudFormation for the relayer's signing key (AWS KMS) |
| `scripts/` | Local fork and deploy helpers |
| `brand/` | Logo files |

## Run locally

Needs [Foundry](https://book.getfoundry.sh/) and Node.

```bash
scripts/local-fork.sh                 # terminal 1: a mainnet fork on :8545
scripts/local-setup.sh                # terminal 2: deploy the vault, write web/.env.local
npm install                           # the relayer's dependencies
cd web && npm install && npm run dev  # http://localhost:5173
```

Pick **Anvil dev wallet (local)** in the wallet menu; it only exists on the local fork. To use
your own wallet, pass its address to `local-setup.sh` and it is funded with test ETH and USDC.

## Test

```bash
cd contracts && forge test            # unit, fuzz and invariant tests
MAINNET_RPC_URL=<url> forge test --match-contract Fork   # real renewals on a fork
npm test                              # relayer (from the repo root)
```

## Deploy

- **Contract.** `scripts/deploy-sepolia.sh` deploys the vault from a Foundry keystore account and
  prints the values the site needs.
- **Site.** Set the `VITE_` variables listed in `web/.env.example` and build `web/`. `vercel.json`
  holds the build settings and security headers.
- **Relayer** (optional). Deploy `infra/relayer-signer.yaml`, then set `RELAYER_KMS_KEY_ARN`,
  `RELAYER_KMS_ROLE_ARN`, `RELAYER_ADDRESS` and `RELAYER_ORIGINS`, and fund the relayer address
  with ETH for gas. Without these the site asks for a wallet instead.

## License

[MIT](LICENSE)
