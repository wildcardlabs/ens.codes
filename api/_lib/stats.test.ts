import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Address, Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { admit, Denied, SIGN_IN_STATEMENT, statsConfigFromEnv, summarise, type Door, type VaultEvent } from './stats.js'

const NOW = 1_800_000_000
const owner = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())

const door = (over: Partial<Door> = {}): Door => ({ chainId: 11155111, admin: owner.address, host: 'ens.codes', origins: ['https://ens.codes'], now: NOW, ...over })

type Fields = Partial<Parameters<typeof createSiweMessage>[0]>
async function signIn(account = owner, over: Fields = {}) {
  const message = createSiweMessage({
    domain: 'ens.codes',
    uri: 'https://ens.codes',
    address: account.address,
    chainId: 11155111,
    version: '1',
    statement: SIGN_IN_STATEMENT,
    nonce: 'abcdef0123456789',
    issuedAt: new Date(NOW * 1000),
    expirationTime: new Date((NOW + 3600) * 1000),
    ...over,
  })
  return { message, signature: await account.signMessage({ message }) }
}
const refused = async (body: unknown, d: Door, status: number) =>
  assert.rejects(admit(body, d), (err) => err instanceof Denied && err.status === status)

test('the owner signs in', async () => {
  await admit(await signIn(), door())
  // With no list of pages, the page must be the host the request arrived at.
  await admit(await signIn(owner, { domain: 'localhost:5173', uri: 'http://localhost:5173' }), door({ origins: [], host: 'localhost:5173' }))
})

test('anyone else is refused', async () => {
  await refused(await signIn(stranger), door(), 403)
  // The owner's address with someone else's signature.
  const forged = { message: (await signIn()).message, signature: (await signIn(stranger)).signature }
  await refused(forged, door(), 403)
})

test('a sign-in for another page, chain, purpose or time is refused', async () => {
  await refused(await signIn(owner, { domain: 'evil.example', uri: 'https://evil.example' }), door(), 401)
  await refused(await signIn(owner, { uri: 'https://evil.example' }), door(), 401)
  await refused(await signIn(owner, { domain: 'evil.example', uri: 'https://evil.example' }), door({ origins: [], host: 'ens.codes' }), 401)
  await refused(await signIn(owner, { chainId: 1 }), door(), 401)
  await refused(await signIn(owner, { statement: 'Unlock the codes bought with this wallet. This is free and does not move any funds.' }), door(), 401)
  await refused(await signIn(owner, { expirationTime: new Date((NOW - 1) * 1000), issuedAt: new Date((NOW - 3600) * 1000) }), door(), 401)
  await refused(await signIn(owner, { expirationTime: undefined }), door(), 401)
  await refused(await signIn(owner, { expirationTime: new Date((NOW + 30 * 86400) * 1000) }), door(), 401)
  await refused(await signIn(owner, { issuedAt: new Date((NOW + 3600) * 1000), expirationTime: new Date((NOW + 7200) * 1000) }), door(), 401)
})

test('a request without a sign-in is refused', async () => {
  for (const body of [null, {}, 'x', { message: 'hello', signature: '0x00' }, { message: 5, signature: 5 }]) await refused(body, door(), 401)
})

test('a contract owner is asked onchain', async () => {
  const body = await signIn(stranger, { address: owner.address })
  await admit(body, door({ contractSigned: async () => true }))
  await refused(body, door({ contractSigned: async () => false }), 403)
  await refused(body, door({ contractSigned: async () => Promise.reject(new Error('rpc down')) }), 403)
})

test('the dashboard address comes from the environment when set', () => {
  const env = { VITE_CHAIN_ID: '31337', VITE_VAULT: '0x142510eecbb2d75fd0e463a6af08579b2355f74c', VITE_VAULT_DEPLOY_BLOCK: '12121025' }
  const cfg = statsConfigFromEnv(env)
  assert.equal(cfg.admin, null)
  assert.equal(cfg.deployBlock, 12121025n)
  assert.equal(cfg.logRange, 10_000n)
  assert.equal(statsConfigFromEnv({ ...env, ADMIN_ADDRESS: owner.address.toLowerCase(), VITE_LOG_RANGE: '500' }).admin, owner.address)
  assert.equal(statsConfigFromEnv({ ...env, VITE_LOG_RANGE: '500' }).logRange, 500n)
})

// ------------------------------------------------------------------------------------ figures

const DAY = 86_400
const T0 = Date.parse('2026-11-01T10:00:00Z') / 1000
const alice = '0x00000000000000000000000000000000000A11CE' as Address
const bob = '0x0000000000000000000000000000000000000B0B' as Address
const relayer = '0x00000000000000000000000000000000000000Ee' as Address
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex
let seq = 0
const at = (t: number) => ({ at: t, block: 100 + Math.floor((t - T0) / 12), log: seq++, tx: id(1000 + seq) })
const usd = (n: number) => n * 1_000_000

const story: VaultEvent[] = [
  // Day 1: Alice buys 3 codes of $10 and Bob 1 of $40.
  { ...at(T0), kind: 'bought', id: id(1), buyer: alice, amount: usd(10), count: 3 },
  { ...at(T0 + 60), kind: 'bought', id: id(2), buyer: bob, amount: usd(40), count: 1 },
  // 30 minutes later one of Alice's is redeemed through the relayer, on two names.
  { ...at(T0 + 1800), kind: 'redeemed', id: id(1), names: [{ label: 'alpha', seconds: 365 * DAY }, { label: 'beta', seconds: 100 * DAY }], spent: usd(8), change: usd(2), sender: relayer, gas: '2000000000000000' },
  // Day 3: Alice buys again (60 codes of $2), Bob's is redeemed from a wallet, Alice cancels one.
  { ...at(T0 + 2 * DAY), kind: 'bought', id: id(3), buyer: alice, amount: usd(2), count: 60 },
  { ...at(T0 + 2 * DAY + 60), kind: 'redeemed', id: id(2), names: [{ label: 'alpha', seconds: 365 * DAY }], spent: usd(40), change: 0, sender: bob, gas: '3000000000000000' },
  { ...at(T0 + 2 * DAY + 120), kind: 'cancelled', id: id(1), buyer: alice, count: 1, value: usd(10) },
  { ...at(T0 + 2 * DAY + 180), kind: 'swept', to: bob, amount: 3_200_000 },
]

test('figures add up', () => {
  const s = summarise(story, { now: T0 + 4 * DAY, fee: 50_000, relayer })

  assert.deepEqual(s.days.map((d) => d.day), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
  const [d1, d2, d3] = s.days
  assert.deepEqual(
    { purchases: d1.purchases, codes: d1.codes, sold: d1.sold, fees: d1.fees, newBuyers: d1.newBuyers, redeemed: d1.redeemed, relayed: d1.relayed, names: d1.names, seconds: d1.seconds, spent: d1.spent, change: d1.change },
    { purchases: 2, codes: 4, sold: usd(70), fees: 200_000, newBuyers: 2, redeemed: 1, relayed: 1, names: 2, seconds: 465 * DAY, spent: usd(8), change: usd(2) },
  )
  assert.equal(d2.codes + d2.redeemed + d2.cancelled, 0)
  assert.deepEqual(
    { purchases: d3.purchases, codes: d3.codes, sold: d3.sold, newBuyers: d3.newBuyers, redeemed: d3.redeemed, relayed: d3.relayed, cancelled: d3.cancelled, cancelledValue: d3.cancelledValue },
    { purchases: 1, codes: 60, sold: usd(120), newBuyers: 0, redeemed: 1, relayed: 0, cancelled: 1, cancelledValue: usd(10) },
  )

  assert.deepEqual(s.codes, { sold: 64, redeemed: 2, cancelled: 1, unused: 61, unusedValue: usd(130) })
  // Everything sold is either paid to ENS, returned, or still waiting.
  const sum = (pick: (d: (typeof s.days)[number]) => number) => s.days.reduce((n, d) => n + pick(d), 0)
  assert.equal(sum((d) => d.sold), sum((d) => d.spent + d.change + d.cancelledValue) + s.codes.unusedValue)

  assert.equal(s.buyerCount, 2)
  assert.equal(s.repeatBuyers, 1)
  assert.deepEqual(s.buyers[0], { address: alice, purchases: 2, codes: 63, sold: usd(150), redeemed: 1, cancelled: 1, unused: 61, unusedValue: usd(130), first: T0, last: T0 + 2 * DAY })
  assert.equal(s.buyers[1].address, bob)

  assert.deepEqual(s.sizes, [
    { label: '1 code', codes: 1, purchases: 1 },
    { label: '2–10', codes: 3, purchases: 1 },
    { label: '11–50', codes: 0, purchases: 0 },
    { label: '51–200', codes: 60, purchases: 1 },
  ])
  assert.deepEqual(s.values.map((v) => v.codes), [60, 3, 0, 1, 0, 0])
  assert.deepEqual(s.redeemTime.buckets.map((b) => b.codes), [1, 0, 1, 0, 0])
  assert.equal(s.redeemTime.median, Math.round((1800 + 2 * DAY) / 2))

  assert.deepEqual(s.topNames[0], { name: 'alpha.eth', times: 2, seconds: 730 * DAY })
  assert.equal(s.uniqueNames, 2)
  assert.equal(s.feesSwept, 3_200_000)
  assert.deepEqual(s.relayed, { count: 1, gas: '2000000000000000' })
  assert.deepEqual(s.byWallet, { count: 1 })

  assert.deepEqual(s.activity.map((a) => a.kind), ['swept', 'cancelled', 'redeemed', 'bought', 'redeemed', 'bought', 'bought'])
  const last = s.activity[2]
  assert.ok(last.kind === 'redeemed' && last.who === bob && !last.relayed && last.names[0] === 'alpha.eth')
})

test('no events, no figures', () => {
  const s = summarise([], { now: T0, fee: 50_000, relayer: null })
  assert.deepEqual(s.days, [])
  assert.equal(s.redeemTime.median, null)
  assert.deepEqual(s.codes, { sold: 0, redeemed: 0, cancelled: 0, unused: 0, unusedValue: 0 })
})
