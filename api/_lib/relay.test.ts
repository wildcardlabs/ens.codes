import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keccak256, parseGwei, recoverTransactionAddress, serializeTransaction, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount, sign } from 'viem/accounts'
import { solve, type Pricing } from 'ens-budget'
import { configFromEnv, parseRedeem, unspent } from './relay.js'
import { kmsAccount, parseDerSignature } from './signer.js'

const KEY = generatePrivateKey()
const reference = privateKeyToAccount(KEY)

/** DER-encode (r, s) the way KMS does, optionally with the high-s form KMS is free to return. */
function der(r: bigint, s: bigint): Uint8Array {
  const int = (n: bigint) => {
    let hex = n.toString(16)
    if (hex.length % 2) hex = `0${hex}`
    if (parseInt(hex.slice(0, 2), 16) >= 0x80) hex = `00${hex}`
    const body = Buffer.from(hex, 'hex')
    return Buffer.concat([Buffer.from([0x02, body.length]), body])
  }
  const body = Buffer.concat([int(r), int(s)])
  return new Uint8Array(Buffer.concat([Buffer.from([0x30, body.length]), body]))
}
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

test('the KMS signer produces a transaction that recovers to the relayer, for low and high s', async () => {
  for (const flip of [false, true]) {
    const account = kmsAccount({ keyArn: 'k', roleArn: 'r', region: 'us-east-1', address: reference.address }, async (hash: Hex) => {
      const sig = await sign({ hash, privateKey: KEY })
      const s = BigInt(sig.s)
      return der(BigInt(sig.r), flip ? N - s : s)
    })
    const tx = { type: 'eip1559', chainId: 11155111, to: reference.address, data: '0x1234', value: 0n, nonce: 7, gas: 100_000n, maxFeePerGas: parseGwei('2'), maxPriorityFeePerGas: parseGwei('1') } as const
    const raw = await account.signTransaction(tx)
    assert.equal(await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` }), reference.address)
    assert.equal(raw, await reference.signTransaction(tx))
    assert.ok(keccak256(serializeTransaction(tx)))
  }
})

test('a key that is not the relayer is refused', async () => {
  const other = privateKeyToAccount(generatePrivateKey())
  const account = kmsAccount({ keyArn: 'k', roleArn: 'r', region: 'us-east-1', address: other.address }, async (hash: Hex) => {
    const sig = await sign({ hash, privateKey: KEY })
    return der(BigInt(sig.r), BigInt(sig.s))
  })
  await assert.rejects(account.signMessage({ message: 'x' }), /does not match RELAYER_ADDRESS/)
})

test('malformed DER is refused', () => {
  assert.throws(() => parseDerSignature(new Uint8Array([0x30, 0x02, 0x02, 0x00])), /malformed/)
  assert.throws(() => parseDerSignature(new Uint8Array([0x31, 0x00])), /malformed/)
})

const RELAYER = reference.address
const now = 1_800_000_000
const good = () => ({
  redeem: {
    buyer: '0x1208a26FAa0F4AC65B42098419EB4dAA5e580AC6',
    root: `0x${'ab'.repeat(32)}`,
    index: '3',
    renewals: [{ renewer: '0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3', label: 'namepass', duration: '86400' }],
    maxAmount: '5000000',
    relayer: RELAYER,
    deadline: String(now + 1800),
  },
  signature: `0x${'11'.repeat(65)}`,
  proof: [`0x${'22'.repeat(32)}`],
})

test('a well-formed request becomes the vault arguments', () => {
  const [r, sig, proof] = parseRedeem(good(), RELAYER, now)
  assert.equal(r.index, 3n)
  assert.equal(r.renewals[0].duration, 86400n)
  assert.equal(r.maxAmount, 5_000_000n)
  assert.equal(sig.length, 132)
  assert.equal(proof.length, 1)
})

test('requests out of shape or for another relayer are refused', () => {
  const cases: [string, (b: ReturnType<typeof good>) => unknown][] = [
    ['another relayer', (b) => ((b.redeem.relayer = '0x0000000000000000000000000000000000000001'), b)],
    ['any relayer', (b) => ((b.redeem.relayer = '0x0000000000000000000000000000000000000000'), b)],
    ['expired', (b) => ((b.redeem.deadline = String(now - 1)), b)],
    ['dated too far ahead', (b) => ((b.redeem.deadline = String(now + 7200)), b)],
    ['no names', (b) => ((b.redeem.renewals = []), b)],
    ['dated too soon', (b) => ((b.redeem.deadline = String(now + 60)), b)],
    ['six names', (b) => ((b.redeem.renewals = Array(6).fill(b.redeem.renewals[0])), b)],
    ['index past 255', (b) => ((b.redeem.index = '256'), b)],
    ['a number, not a string', (b) => (((b.redeem as Record<string, unknown>).maxAmount = 5), b)],
    ['short signature', (b) => ((b.signature = '0x1234'), b)],
    ['long proof', (b) => ((b.proof = Array(17).fill(b.proof[0])), b)],
    ['empty label', (b) => ((b.redeem.renewals[0].label = ''), b)],
    ['not an object', () => 'x'],
  ]
  for (const [name, change] of cases) assert.throws(() => parseRedeem(change(good()), RELAYER, now), name)
})

test('the site\'s own range of deadlines and names is accepted', () => {
  for (const ahead of [600, 1800, 3600]) {
    const b = good()
    b.redeem.deadline = String(now + ahead)
    assert.ok(parseRedeem(b, RELAYER, now), `${ahead}s ahead`)
  }
  const b = good()
  b.redeem.renewals = Array(5).fill(b.redeem.renewals[0])
  assert.equal(parseRedeem(b, RELAYER, now)[0].renewals.length, 5)
})

/** ENS's USDC pricing: $5 a year for 5+ characters, $160 for 4, $640 for 3, and a discount from one year. */
const YEAR = 31_536_000n
const perYear = (usd: bigint) => (usd * 10n ** 18n) / YEAR
const flat: Pricing = {
  oracle: '0x0000000000000000000000000000000000000001',
  token: '0x0000000000000000000000000000000000000002',
  baseRates: [0n, 0n, perYear(640n), perYear(160n), perYear(5n)],
  discountPoints: [],
  discountDenominator: 0n,
  tokenRatio: { numer: 1n, denom: 10n ** 12n },
}
const tiered: Pricing = { ...flat, discountPoints: [{ duration: YEAR, numer: 9_500n }, { duration: 3n * YEAR, numer: 8_000n }], discountDenominator: 10_000n }

test('a redemption that spends the code the way the site does passes', () => {
  for (const pricing of [flat, tiered]) {
    for (const value of [1_000_000n, 5_000_000n, 12_340_000n, 500_000_000n]) {
      // One name takes the whole code.
      const one = solve(pricing, { label: 'namepass', budget: value })
      assert.equal(unspent(value, [{ pricing, label: 'namepass', duration: one.duration }]), null, `one name, ${value}`)
      // Several names, split the way the site splits: equal shares to the cent, the last takes the rest.
      const labels = ['namepass', 'nick', 'abc', 'vitalik', 'ensdomains'].filter((l) => solve(pricing, { label: l, budget: value / 5n }).duration > 0n)
      const share = (value / BigInt(labels.length) / 10_000n) * 10_000n
      const names = labels.map((label, i) => {
        const budget = i === labels.length - 1 ? value - share * BigInt(labels.length - 1) : share
        return { pricing, label, duration: solve(pricing, { label, budget }).duration }
      })
      assert.equal(unspent(value, names), null, `${labels.length} names, ${value}`)
    }
  }
})

test('a redemption that leaves money a longer renewal could spend is refused', () => {
  for (const pricing of [flat, tiered]) {
    const value = 25_000_000n
    // One second: nearly the whole code would go back to the buyer.
    const left = unspent(value, [{ pricing, label: 'namepass', duration: 1n }])
    assert.ok(left !== null && left > 24_000_000n)
    // Every name short by a day.
    const best = solve(pricing, { label: 'namepass', budget: value }).duration
    assert.notEqual(unspent(value, [{ pricing, label: 'namepass', duration: best - 86_400n }]), null)
    // Five names at one second each.
    assert.notEqual(unspent(value, Array(5).fill({ pricing, label: 'namepass', duration: 1n })), null)
  }
})

test('a redemption that costs more than the code is left to the vault to refuse', () => {
  assert.equal(unspent(1_000_000n, [{ pricing: flat, label: 'namepass', duration: 10n * YEAR }]), null)
})

test('settings: no signer means relaying is off; a half-set signer is an error', () => {
  const base = { VITE_CHAIN_ID: '11155111', VITE_VAULT: '0x142510eecbb2d75fd0e463a6af08579b2355f74c' }
  assert.equal(configFromEnv(base).account, null)
  assert.throws(() => configFromEnv({ ...base, RELAYER_KMS_KEY_ARN: 'arn:aws:kms:us-east-1:123456789012:key/00000000-0000-0000-0000-000000000000' }), /ROLE_ARN/)
  const on = configFromEnv({
    ...base,
    RELAYER_KMS_KEY_ARN: 'arn:aws:kms:us-east-1:123456789012:key/00000000-0000-0000-0000-000000000000',
    RELAYER_KMS_ROLE_ARN: 'arn:aws:iam::123456789012:role/test-relayer-signer',
    RELAYER_ADDRESS: RELAYER,
  })
  assert.equal(on.account?.address, RELAYER)
  assert.equal(on.maxFeePerGas, parseGwei('200'))
  assert.equal(configFromEnv({ VITE_CHAIN_ID: '1', VITE_VAULT: base.VITE_VAULT }).maxFeePerGas, parseGwei('3'))
  assert.ok(on.rpcUrls.length >= 2, 'more than one RPC by default')
  const urls = configFromEnv({ ...base, RELAYER_RPC_URL: 'https://a.example, https://b.example', VITE_RPC_URL: 'https://site.example' }).rpcUrls
  assert.deepEqual(urls.slice(0, 3), ['https://a.example', 'https://b.example', 'https://site.example'], 'named RPCs, then the site\'s own')
  assert.ok(urls.length > 3, 'public RPCs stay as the last resort')
  assert.equal(configFromEnv({ ...base, VITE_RPC_URL: 'https://site.example' }).rpcUrls[0], 'https://site.example')
})
