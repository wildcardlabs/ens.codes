import { keccak256, toBytes } from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'

/**
 * Claim codes: 25 Crockford base32 characters in five groups of five.
 *
 *   18 characters  the secret (90 bits). The code's key is keccak256("ens.codes-v2:" + secret),
 *                  and that key's address is what the vault knows the code by.
 *    6 characters  where it was bought: the purchase's block, counted from the vault's deploy
 *                  block. The vault stores one record per purchase, so this is how the redeem page
 *                  finds a code's purchase in one request instead of searching all of history.
 *    1 character   a check character over the other 24.
 *
 * The location is not secret (purchases are public) and is not part of the key. It is mixed with
 * bits derived from the secret only so the code doesn't end in a run of zeros.
 */

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const SECRET = 18
const WHERE = 6
const BODY = SECRET + WHERE
const TOTAL = BODY + 1
/** The largest block offset six characters can hold: about 400 years of 12-second blocks. */
const MAX_OFFSET = 2 ** (WHERE * 5) - 1

const check = (body: string) => ALPHABET[toBytes(keccak256(toBytes(body)))[0] & 31]

/** FROZEN: 30 bits from the secret that the location is XORed with, so it reads like the rest of the code. */
function mask(secret: string): number {
  const b = toBytes(keccak256(toBytes(`ens.codes-where:${secret}`)))
  return (((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0) & MAX_OFFSET
}

/** Uppercase, strip separators, and fold look-alikes (O→0, I/L→1). Drops anything else. */
export function clean(input: string): string {
  return input
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, '')
}

/** Format partial input as the user types: groups of five joined by dashes. */
export function format(input: string): string {
  const s = clean(input).slice(0, TOTAL)
  return s.match(/.{1,5}/g)?.join('-') ?? ''
}

export type Parsed =
  | { ok: true; body: string; /** The 18 secret characters the key comes from. */ secret: string; /** Blocks after the vault's deploy block. */ offset: number }
  | { ok: false; error: string; incomplete?: boolean }

export function parse(input: string): Parsed {
  const s = clean(input)
  if (s.length < TOTAL) return { ok: false, error: `${TOTAL - s.length} more characters`, incomplete: true }
  if (s.length > TOTAL) return { ok: false, error: 'Codes are 25 characters' }
  const body = s.slice(0, BODY)
  if (s[BODY] !== check(body)) return { ok: false, error: 'That code has a typo. Check each character.' }
  const secret = body.slice(0, SECRET)
  let where = 0
  for (const ch of body.slice(SECRET)) where = where * 32 + ALPHABET.indexOf(ch)
  return { ok: true, body, secret, offset: (where ^ mask(secret)) >>> 0 }
}

/** A link that opens the redeem page with this code. */
export const redeemLink = (code: string) => `${location.origin}/redeem#${code}`

/** A valid code from the current URL's fragment, if there is one. */
export function codeFromHash(): string | null {
  const p = parse(decodeURIComponent(location.hash.slice(1)))
  return p.ok ? format(decodeURIComponent(location.hash.slice(1))) : null
}

/** The full, formatted code for a secret bought `offset` blocks after the vault's deploy block. */
export function codeFor(secret: string, offset: number): string {
  if (secret.length !== SECRET) throw new Error('A code secret is 18 characters.')
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new Error('This purchase is too far from the vault’s deploy block to fit in a code.')
  let where = ''
  for (let i = 0, n = (offset ^ mask(secret)) >>> 0; i < WHERE; i++, n = Math.floor(n / 32)) where = ALPHABET[n % 32] + where
  const body = secret + where
  return format(body + check(body))
}

/** The signing key for a full code, with or without dashes. Its address identifies the code onchain. */
export function keyForCode(code: string): PrivateKeyAccount {
  const p = parse(code)
  if (!p.ok) throw new Error('Invalid code')
  return keyForSecret(p.secret)
}

/** FROZEN: changing the `ens.codes-v2:` prefix would turn every existing code into a different key. */
export function keyForSecret(secret: string): PrivateKeyAccount {
  return privateKeyToAccount(keccak256(toBytes(`ens.codes-v2:${secret}`)))
}
