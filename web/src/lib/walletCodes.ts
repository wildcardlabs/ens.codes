import { type Address, concat, getAddress, type Hex, keccak256, numberToBytes, toBytes, type WalletClient } from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { CHAIN_ID } from './config'
import { ensureChainFor } from './wallet'
import { ALPHABET, SECRET } from './code'

/**
 * Codes recoverable from the buying wallet.
 *
 * The wallet signs one fixed message per visit. Standard wallets (ECDSA with RFC 6979: MetaMask,
 * Rabby, Ledger, Trezor and most others) return the same signature every time, so
 * keccak256(signature) is a stable master secret only that wallet can reproduce. Code #i is
 * derived from the master and i, so every code the wallet bought can be shown again later.
 *
 * Derived codes are checked against the wallet's purchases onchain before they are shown, and the
 * buyer can cancel any unused code at any time.
 */

/**
 * A Sign-In with Ethereum (EIP-4361) message, so wallets check it against the site asking and warn
 * when any other domain requests it.
 *
 * Every field is fixed per wallet, domain and chain so the signature, and so the codes, come out the
 * same each time: the nonce is derived from the address and Issued At is a constant.
 */
const ISSUED_AT = new Date('2026-01-01T00:00:00.000Z')

/**
 * FROZEN. These strings are part of what the wallet signs and of how codes are derived from it, so
 * they never change. They are worded without the product's name so that copy changes have no reason
 * to touch them. A new scheme would be added as a new version alongside this one.
 */
const STATEMENT = 'Unlock the codes bought with this wallet. This is free and does not move any funds.'
const NONCE_SALT = 'ens.codes'
const CODE_SALT = 'ens.codes code'
/** keccak256 of the three strings above joined by newlines. The module refuses to load if they drift. */
const FROZEN = '0xf9aba42fe33f04f20c6aa6f5b24a5ba68c986c27d11eb56215463f21a7037de3'
if (keccak256(toBytes([STATEMENT, NONCE_SALT, CODE_SALT].join('\n'))) !== FROZEN)
  throw new Error('walletCodes: the frozen unlock strings changed. Revert the change.')

const message = (address: Address) =>
  createSiweMessage({
    domain: window.location.host,
    uri: window.location.origin,
    address: getAddress(address),
    chainId: CHAIN_ID,
    version: '1',
    statement: STATEMENT,
    nonce: keccak256(toBytes(`${NONCE_SALT} ${address.toLowerCase()}`)).slice(2, 18),
    issuedAt: ISSUED_AT,
  })

/** Unlocked masters for this tab only, by wallet address. Never stored. */
const masters = new Map<string, Hex>()

export const isUnlocked = (address: Address) => masters.has(address.toLowerCase())

export async function unlockCodes(wallet: WalletClient, address: Address): Promise<Hex> {
  const key = address.toLowerCase()
  const cached = masters.get(key)
  if (cached) return cached
  await ensureChainFor(wallet)
  const sig = await wallet.signMessage({ account: address, message: message(address) })
  const master = keccak256(sig)
  masters.set(key, master)
  return master
}

/**
 * The secret of this wallet's code number `index` (see `code.ts`). The full code also carries where
 * it was bought, which is only known once the purchase is onchain.
 */
export function walletSecret(master: Hex, index: number): string {
  // All parts as bytes: viem's concat needs one kind (hex strings or byte arrays), not a mix.
  const bytes = toBytes(keccak256(concat([toBytes(master), toBytes(CODE_SALT), numberToBytes(index, { size: 4 })])))
  return Array.from(bytes.slice(0, SECRET), (b) => ALPHABET[b & 31]).join('')
}
