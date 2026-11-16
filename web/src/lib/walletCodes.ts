import { type Address, concat, type Hex, keccak256, numberToBytes, toBytes } from 'viem'
import { ALPHABET, keyForSecret, SECRET } from './code'
import { CHAIN_ID, VAULT } from './config'
import { merkleRoot } from './merkle'

/**
 * Codes recoverable by the buyer.
 *
 * The buyer's passkey (see `passkey.ts`) turns a fixed input into the same 32 secret bytes every
 * time. The input names the wallet that pays, the chain and the vault, so each wallet has its own
 * master secret, keccak256(passkey output), and a new vault never repeats an old vault's codes.
 * Code #i is derived from the master and i, so every code the wallet bought can be shown again
 * later with the same passkey.
 *
 * Derived codes are checked against the wallet's purchases onchain before they are shown, and the
 * buyer can cancel any unused code at any time with the wallet that paid.
 */

/**
 * FROZEN. These strings are part of what the passkey is asked and of how codes are derived from its
 * answer, so they never change. A new scheme would be added as a new version alongside this one.
 */
const UNLOCK = 'Unlock the codes bought with this wallet.'
const CODE_SALT = 'ens.codes code'
/** keccak256 of the two strings above joined by a newline. The module refuses to load if they drift. */
const FROZEN = '0xb86ce53a1fbb31d922dea25098936ab84333ecb4e413a5041e98bffcfc86eb22'
if (keccak256(toBytes([UNLOCK, CODE_SALT].join('\n'))) !== FROZEN) throw new Error('walletCodes: the frozen unlock strings changed. Revert the change.')

/** What the passkey is asked for this wallet: the same bytes every time for the same wallet, chain and vault. */
export const unlockInput = (address: Address): Uint8Array<ArrayBuffer> =>
  new Uint8Array(toBytes(keccak256(toBytes([UNLOCK, CHAIN_ID, VAULT.toLowerCase(), address.toLowerCase()].join('\n')))))

/** Unlocked masters for this tab only, by wallet address. Never stored. */
const masters = new Map<string, Hex>()

export const isUnlocked = (address: Address) => masters.has(address.toLowerCase())
export const masterOf = (address: Address) => masters.get(address.toLowerCase()) ?? null

/** Keep the master the passkey gave for this wallet, for the rest of the visit. */
export function unlock(address: Address, passkeyOutput: Uint8Array): Hex {
  const master = keccak256(passkeyOutput)
  masters.set(address.toLowerCase(), master)
  return master
}

/** Drop a master that turned out to be from another passkey, so the next try asks again. */
export const forget = (address: Address) => void masters.delete(address.toLowerCase())

/**
 * The secret of this wallet's code number `index` (see `code.ts`). The full code also carries where
 * it was bought, which is only known once the purchase is onchain.
 */
export function walletSecret(master: Hex, index: number): string {
  // All parts as bytes: viem's concat needs one kind (hex strings or byte arrays), not a mix.
  const bytes = toBytes(keccak256(concat([toBytes(master), toBytes(CODE_SALT), numberToBytes(index, { size: 4 })])))
  return Array.from(bytes.slice(0, SECRET), (b) => ALPHABET[b & 31]).join('')
}

/**
 * Whether `master` rebuilds a purchase whose codes are numbers `first` to `first + count - 1`: the
 * proof that this is the passkey the wallet bought with.
 */
export function rebuilds(master: Hex, purchase: { root: Hex; count: number }, first: number): boolean {
  const secrets = Array.from({ length: purchase.count }, (_, i) => walletSecret(master, first + i))
  return merkleRoot(secrets.map((s) => keyForSecret(s).address)) === purchase.root
}
