// Regenerates src/abi.ts from the Foundry build output. Run `forge build` in ../contracts first.
import { readFileSync, writeFileSync } from 'node:fs'

const artifact = JSON.parse(readFileSync(new URL('../../contracts/out/ClaimCodeVault.sol/ClaimCodeVault.json', import.meta.url)))
const abi = artifact.abi.filter((x) => x.type !== 'constructor')
writeFileSync(
  new URL('../src/lib/abi.ts', import.meta.url),
  `// Generated from contracts/out by \`npm run abi\`. Do not edit.\nexport const vaultAbi = ${JSON.stringify(abi, null, 2)} as const\n`,
)
console.log(`wrote ${abi.length} ABI entries`)
