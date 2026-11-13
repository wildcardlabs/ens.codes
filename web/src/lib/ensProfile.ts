import { useEffect, useState } from 'react'
import type { Address } from 'viem'

/** An address's ENS primary name and avatar, from resolvio's reverse profile API. */
export type EnsProfile = { name: string; avatar: string | null }

const API = 'https://api.resolvio.xyz/ens/v2/reverse'

/** One request per address per visit; failures resolve to null so the address is shown instead. */
const cache = new Map<string, Promise<EnsProfile | null>>()

export function fetchEnsProfile(address: Address): Promise<EnsProfile | null> {
  const key = address.toLowerCase()
  let p = cache.get(key)
  if (!p) {
    p = fetch(`${API}/${address}/profile`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { hasReverseRecord?: boolean; name?: string | null; avatar?: string | null } | null) =>
        d?.hasReverseRecord && d.name ? { name: d.name, avatar: d.avatar ?? null } : null,
      )
      .catch(() => null)
    cache.set(key, p)
  }
  return p
}

export function useEnsProfile(address: Address | undefined): EnsProfile | null {
  const [profile, setProfile] = useState<EnsProfile | null>(null)
  useEffect(() => {
    setProfile(null)
    if (!address) return
    let live = true
    fetchEnsProfile(address).then((p) => live && setProfile(p))
    return () => {
      live = false
    }
  }, [address])
  return profile
}
