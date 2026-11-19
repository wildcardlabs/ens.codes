/**
 * What the dashboard's page and its server function share. Nothing here imports anything, so the
 * page can use it as it is.
 */

/** What the wallet is shown when signing in. The page signs exactly this; the server refuses anything else. */
export const SIGN_IN_STATEMENT = 'Sign in to the ens.codes dashboard. This is free and does not move any funds.'
/** The longest a sign-in may last, in seconds. */
export const MAX_SESSION = 7 * 24 * 60 * 60

/**
 * What the dashboard is sent. USDC amounts are whole numbers of its smallest unit (1 USDC =
 * 1,000,000), times are Unix seconds and ETH amounts are wei as decimal strings.
 */

/** One UTC day of activity. Every day from the first event to today is present, quiet ones as zeros. */
export type Day = {
  /** YYYY-MM-DD. */
  day: string
  purchases: number
  /** Codes bought, and their total value. */
  codes: number
  sold: number
  fees: number
  /** Wallets whose first purchase was on this day. */
  newBuyers: number
  /** Codes redeemed, and how many of those the relayer sent. */
  redeemed: number
  relayed: number
  /** Names renewed, the time added to them in seconds, and what ENS was paid. */
  names: number
  seconds: number
  spent: number
  /** What redeemed codes didn't spend, returned to their buyers. */
  change: number
  /** Codes cancelled by their buyers, and the value returned. */
  cancelled: number
  cancelledValue: number
}

export type Buyer = {
  address: string
  purchases: number
  codes: number
  sold: number
  redeemed: number
  cancelled: number
  unused: number
  unusedValue: number
  first: number
  last: number
}

export type Activity =
  | { kind: 'bought'; at: number; tx: string; who: string; codes: number; amount: number }
  /** `who` sent the redemption (the relayer when `relayed`); `buyer` is whose code it was. */
  | { kind: 'redeemed'; at: number; tx: string; who: string; buyer: string | null; names: string[]; spent: number; change: number; relayed: boolean }
  | { kind: 'cancelled'; at: number; tx: string; who: string; codes: number; amount: number }
  | { kind: 'swept'; at: number; tx: string; who: string; amount: number }
  /** A redemption's leftover the buyer couldn't receive, held for them (`claimed` false), or them taking it later. */
  | { kind: 'refund'; at: number; tx: string; who: string; amount: number; claimed: boolean }
  /** `who` is the renewer. `activatesAt` is set for a proposal. */
  | { kind: 'renewer'; at: number; tx: string; who: string; change: RenewerChange; activatesAt: number | null }
  /** `who` is the new owner for ownership changes, else null. `amount` is the new largest code for `limit`. */
  | { kind: 'admin'; at: number; tx: string; who: string | null; change: AdminChange; amount: number | null }

export type RenewerChange = 'proposed' | 'added' | 'cancelled' | 'removed'
export type AdminChange = 'paused' | 'unpaused' | 'limit' | 'ownershipStarted' | 'ownershipTransferred'

export type Bucket = { label: string; codes: number; purchases?: number }

/** Everything worked out from the vault's events alone. */
export type Summary = {
  days: Day[]
  buyers: Buyer[]
  buyerCount: number
  /** Wallets that bought more than once. */
  repeatBuyers: number
  activity: Activity[]
  codes: { sold: number; redeemed: number; cancelled: number; unused: number; unusedValue: number }
  /** Purchases by how many codes they held, and codes by their value. */
  sizes: Bucket[]
  values: Bucket[]
  /** How long codes waited between purchase and redemption. */
  redeemTime: { median: number | null; buckets: Bucket[] }
  topNames: { name: string; times: number; seconds: number }[]
  uniqueNames: number
  feesSwept: number
  /**
   * Redemption leftovers the buyer couldn't receive at the time: `held` in all (already counted in
   * each day's `change`), and how much of it buyers have since claimed.
   */
  refunds: { held: number; claimed: number }
  relayed: { count: number; gas: string }
  byWallet: { count: number }
}

export type Stats = Summary & {
  chainId: number
  vault: string
  block: number
  asOf: number
  /** The fee charged per code. */
  fee: number
  state: { usdc: number; feesAccrued: number; feeRecipient: string; paused: boolean; maxCodeAmount: number }
  /** Leftovers held for buyers right now, read from the vault: the total and who is owed. */
  owed: { total: number; buyers: { address: string; amount: number }[] }
  /** Who controls the vault. Null where the vault can't say (an older vault without these reads). */
  governance: {
    owner: string
    /** Set while an ownership handover waits for the new owner to accept it. */
    pendingOwner: string | null
    /** Contracts the vault pays for renewals right now. `name` for the ENS contracts we know. */
    renewers: { address: string; name: string | null }[]
    /**
     * Proposed renewers not yet activated or cancelled. Anyone can activate one from `activatesAt`
     * until `closesAt`; after that it lapses, but stays listed until the owner cancels it.
     */
    proposals: { address: string; name: string | null; activatesAt: number; closesAt: number }[]
  } | null
  /** `gasPrice` is the network fee now and `maxFee` the most the relayer pays, both in wei. */
  relayer: { address: string | null; enabled: boolean; signer: boolean; funded: boolean; affordable: boolean; balance: string; gasPrice: string; maxFee: string }
}
