import type { Pricing } from 'ens-budget'

/**
 * The name lengths ENS sells, read from the oracle: `baseRates[i]` is the per-second rate for an
 * (i + 1)-character name, the last entry also covers every longer name, and a zero rate means that
 * length is not sold. Longest (cheapest) first. `label` is a stand-in name of that length for pricing.
 */
export function soldLengths(pricing: Pricing) {
  const rates = pricing.baseRates
  return rates
    .map((rate, i) => ({ rate, length: i + 1, last: i === rates.length - 1 }))
    .filter((r) => r.rate > 0n)
    .reverse()
    .map((r) => ({ label: 'a'.repeat(r.length), name: `${r.length}${r.last ? '+' : ''} letters` }))
}
