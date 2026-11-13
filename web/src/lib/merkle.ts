import { type Address, concat, encodePacked, type Hex, keccak256 } from 'viem'

/**
 * The vault's Merkle tree over a purchase's codes, mirrored from ClaimCodeVault.rootOf: a leaf is a
 * code's position and its key's address, leaves are paired left to right, a node without a partner
 * moves up unchanged, and a pair is hashed in sorted order.
 */

export const leafOf = (index: number, code: Address): Hex => keccak256(encodePacked(['uint256', 'address'], [BigInt(index), code]))

const pair = (a: Hex, b: Hex): Hex => keccak256(BigInt(a) < BigInt(b) ? concat([a, b]) : concat([b, a]))

/** Walk the tree once: its root, and the proof for `index` (the sibling at each level that has one). */
function walk(codes: Address[], index: number): { root: Hex; proof: Hex[] } {
  if (codes.length === 0) throw new Error('A purchase has at least one code.')
  let layer = codes.map((code, i) => leafOf(i, code))
  const proof: Hex[] = []
  let pos = index
  while (layer.length > 1) {
    const n = layer.length
    const promoted = n % 2 === 1 && pos === n - 1
    if (!promoted) proof.push(layer[pos ^ 1])
    const next: Hex[] = []
    for (let i = 0; i + 1 < n; i += 2) next.push(pair(layer[i], layer[i + 1]))
    if (n % 2 === 1) next.push(layer[n - 1])
    layer = next
    pos = Math.floor(pos / 2)
  }
  return { root: layer[0], proof }
}

export const merkleRoot = (codes: Address[]): Hex => walk(codes, 0).root
export const merkleProof = (codes: Address[], index: number): Hex[] => walk(codes, index).proof
