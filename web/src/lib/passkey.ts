/**
 * Passkeys that keep codes. A passkey with the PRF extension returns the same 32 secret bytes every
 * time it is asked with the same input, after Face ID, a fingerprint or the device PIN. Those bytes
 * are where a buyer's codes come from (see `walletCodes.ts`), so the wallet that pays never has to
 * sign anything beyond the payment itself, and any wallet can pay.
 *
 * Nothing is sent anywhere: the challenge is random and never checked, because no server verifies
 * these passkeys. Only the PRF output is used, and it never leaves the page.
 */

/** Why a passkey step didn't give a secret, so the page can say what to do next. */
export class PasskeyError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'unsupported' | 'cancelled',
    message: string,
  ) {
    super(message)
  }
}

const UNAVAILABLE = 'Passkeys don’t work in this browser. Open ens.codes in Safari or Chrome to buy; your wallet can still pay from there.'
const UNSUPPORTED = 'This passkey can’t keep codes. Use a passkey saved in iCloud Keychain, Google Password Manager or 1Password.'
const CANCELLED = 'No passkey was used. If you haven’t made one for ens.codes yet, create one.'

/** Whether this browser has passkeys at all. In-app wallet browsers often don't. */
export const passkeysAvailable = () => typeof window !== 'undefined' && window.isSecureContext && typeof window.PublicKeyCredential === 'function'

/**
 * Whether this browser says its passkeys can do PRF: true, false, or null when it doesn't say (older
 * browsers have no way to ask). A false here blocks buying up front; null is settled at the passkey step.
 */
export async function prfSupport(): Promise<boolean | null> {
  if (!passkeysAvailable()) return false
  try {
    const caps = await PublicKeyCredential.getClientCapabilities?.()
    const prf = caps?.['extension:prf']
    return typeof prf === 'boolean' ? prf : null
  } catch {
    return null
  }
}

/**
 * This device has used a passkey here before, so the first button says "Use passkey" rather than
 * "Create a passkey". Only a hint: passkeys sync, and a person can have one this device never saw.
 */
const SEEN = 'ens.codes:passkey'
export function passkeySeen(): boolean {
  try {
    return localStorage.getItem(SEEN) === '1'
  } catch {
    return false
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN, '1')
  } catch {
    // Storage is unavailable (private mode): the hint just isn't kept.
  }
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))
const rpId = () => window.location.hostname

/** Turn a browser refusal into a PasskeyError. Cancelling and "no passkey here" look the same to a page. */
function refused(err: unknown): never {
  if (err instanceof PasskeyError) throw err
  const name = (err as { name?: string }).name
  if (name === 'NotAllowedError' || name === 'AbortError') throw new PasskeyError('cancelled', CANCELLED)
  if (name === 'NotSupportedError') throw new PasskeyError('unsupported', UNSUPPORTED)
  throw err
}

/**
 * The passkey's secret for `salt`. Must be called straight from a click: browsers only open the
 * passkey sheet in response to one. `only` limits the choice to one passkey (the one just made).
 */
export async function passkeySecret(salt: Uint8Array<ArrayBuffer>, only?: ArrayBuffer): Promise<Uint8Array> {
  if (!passkeysAvailable()) throw new PasskeyError('unavailable', UNAVAILABLE)
  let cred: PublicKeyCredential
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        rpId: rpId(),
        userVerification: 'required',
        allowCredentials: only ? [{ type: 'public-key', id: only }] : [],
        extensions: { prf: { eval: { first: salt } } },
      },
    })) as PublicKeyCredential
  } catch (err) {
    refused(err)
  }
  const out = cred.getClientExtensionResults().prf?.results?.first
  if (!out) throw new PasskeyError('unsupported', UNSUPPORTED)
  markSeen()
  return new Uint8Array(out as ArrayBuffer)
}

/**
 * Make a passkey for ens.codes. Some passkey managers return the secret for `salt` right away; the
 * rest only say PRF is on, and the secret takes a second step with the new passkey (`id`).
 */
export async function createPasskey(salt: Uint8Array<ArrayBuffer>): Promise<{ secret: Uint8Array | null; id: ArrayBuffer }> {
  if (!passkeysAvailable()) throw new PasskeyError('unavailable', UNAVAILABLE)
  let cred: PublicKeyCredential
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { id: rpId(), name: 'ens.codes' },
        // The name is what passkey managers list it under; the id only has to be unique.
        user: { id: random(16), name: 'Claim codes', displayName: 'Claim codes' },
        challenge: random(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: { eval: { first: salt } } },
      },
    })) as PublicKeyCredential
  } catch (err) {
    refused(err)
  }
  const prf = cred.getClientExtensionResults().prf
  if (prf?.enabled === false) throw new PasskeyError('unsupported', UNSUPPORTED)
  markSeen()
  const first = prf?.results?.first
  return { secret: first ? new Uint8Array(first as ArrayBuffer) : null, id: cred.rawId }
}
