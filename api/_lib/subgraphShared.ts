/**
 * Reading the vault's history from its subgraph (indexer/, hosted on Goldsky). The site and the
 * dashboard's server function both use this, so nothing here imports anything.
 *
 * Each read is pinned to one block the subgraph has reached. The caller reads anything newer from
 * the chain, so a subgraph a few blocks behind still gives complete answers.
 */

const PAGE = 1000
const TIMEOUT_MS = 10_000

type Body = { data?: Record<string, unknown>; errors?: { message: string }[] }

async function post(url: string, query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`The subgraph answered ${res.status}`)
  const body = (await res.json()) as Body
  if (body.errors?.length || !body.data) throw new Error(`The subgraph refused the query: ${body.errors?.[0]?.message ?? 'no data'}`)
  return body.data
}

/** The newest block the subgraph has indexed. A subgraph stopped on an error is not used. */
export async function indexedBlock(url: string): Promise<bigint> {
  const data = (await post(url, '{ _meta { block { number } hasIndexingErrors } }', {})) as {
    _meta: { block: { number: number }; hasIndexingErrors: boolean }
  }
  if (data._meta.hasIndexingErrors) throw new Error('The subgraph has stopped on an error')
  return BigInt(data._meta.block.number)
}

/**
 * Every `type` entity matching `where` as of block `at`, a page at a time. `field` is the entity's
 * plural query name (purchases, redemptions…). Filter values are strings: addresses and hashes in
 * lower case, numbers in decimal.
 */
export async function indexedAll<T extends { id: string }>(
  url: string,
  type: string,
  field: string,
  fields: string,
  where: Record<string, unknown>,
  at: bigint,
): Promise<T[]> {
  const query = `query($w: ${type}_filter!, $n: Int!) { items: ${field}(first: ${PAGE}, orderBy: id, orderDirection: asc, where: $w, block: { number: $n }) { id ${fields} } }`
  const out: T[] = []
  let after: string | null = null
  for (;;) {
    const data = (await post(url, query, { w: after ? { ...where, id_gt: after } : where, n: Number(at) })) as { items: T[] }
    out.push(...data.items)
    if (data.items.length < PAGE) return out
    after = data.items[data.items.length - 1].id
  }
}

/**
 * The transactions of the owner and renewer events the subgraph holds at `block`, as of block `at`.
 * The vault's constructor emits these, so at its deploy block they must match the chain's: that is
 * how a caller knows the subgraph indexes this vault and not another one.
 */
export async function indexedTxsAt(url: string, block: bigint, at: bigint): Promise<Set<string>> {
  const where = { block: block.toString() }
  const [renewers, admin] = await Promise.all([
    indexedAll<{ id: string; tx: string }>(url, 'RenewerChange', 'renewerChanges', 'tx', where, at),
    indexedAll<{ id: string; tx: string }>(url, 'AdminChange', 'adminChanges', 'tx', where, at),
  ])
  return new Set([...renewers, ...admin].map((r) => r.tx.toLowerCase()))
}
