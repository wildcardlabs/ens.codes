import { addresses, type Renewers } from 'ens-budget'
import { type Address, type Chain, createPublicClient, defineChain, http } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

const env = import.meta.env

/** 1 = mainnet, 11155111 = Sepolia, 31337 = local anvil fork of mainnet. */
export const CHAIN_ID = Number(env.VITE_CHAIN_ID ?? 31337)
const RPC_URL: string | undefined = env.VITE_RPC_URL || undefined

const anvilFork = defineChain({
  id: 31337,
  name: 'Anvil (mainnet fork)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  // The fork has mainnet's contracts, Multicall3 included.
  contracts: { multicall3: mainnet.contracts.multicall3 },
})

const base: Chain = CHAIN_ID === 1 ? mainnet : CHAIN_ID === 11155111 ? sepolia : anvilFork
export const chain: Chain = RPC_URL ? { ...base, rpcUrls: { default: { http: [RPC_URL] } } } : base

/**
 * What a wallet is told when it has to add this network: public RPCs, which any wallet can use.
 */
const WALLET_RPCS: Record<number, string[]> = {
  1: ['https://ethereum-rpc.publicnode.com', 'https://eth.merkle.io'],
  11155111: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co'],
}
export const walletChain = {
  chainName: base.name,
  nativeCurrency: base.nativeCurrency,
  rpcUrls: WALLET_RPCS[CHAIN_ID] ?? [...base.rpcUrls.default.http],
  ...(base.blockExplorers ? { blockExplorerUrls: [base.blockExplorers.default.url] } : {}),
}

/** The local fork keeps mainnet's contracts at a different chain id. */
const deployed = addresses[CHAIN_ID === 31337 ? 1 : (CHAIN_ID as 1 | 11155111)]
if (!deployed) throw new Error(`Unsupported VITE_CHAIN_ID ${CHAIN_ID}`)

export const USDC: Address = deployed.usdc
export const RENEWERS: Renewers = { ethRegistrar: deployed.ethRegistrar, ethRenewerV1: deployed.ethRenewerV1 }

export const VAULT = (env.VITE_VAULT ?? '') as Address
export const VAULT_DEPLOY_BLOCK = BigInt(env.VITE_VAULT_DEPLOY_BLOCK ?? 0)

/**
 * The most blocks one history request may cover. Providers cap this (Goldsky: 10,000), so the
 * vault's events are read a window at a time. Set VITE_LOG_RANGE to match another provider.
 */
export const LOG_RANGE = BigInt(env.VITE_LOG_RANGE || 10_000)

/** Local testing only: announces an EIP-6963 wallet backed by anvil's unlocked accounts. */
export const DEV_WALLET = env.VITE_DEV_WALLET === '1' && CHAIN_ID === 31337

/** How many names one code can be split across on the redeem page. The vault itself allows 10. */
export const MAX_NAMES = 5

/** Where transaction links point. The local fork has none unless VITE_EXPLORER_URL is set (e.g. a local Otterscan). */
export const EXPLORER_URL: string | undefined = env.VITE_EXPLORER_URL || chain.blockExplorers?.default.url

/** Reads made in the same moment travel as one request (Multicall3), e.g. the state of every purchase on My codes. */
export const publicClient = createPublicClient({ chain, transport: http(), batch: { multicall: true } })

export const VAULT_DOMAIN = {
  name: 'ENS Claim Code',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: VAULT,
} as const

/** The site's public address, as printed on pages and on downloaded tickets. */
export const SITE_HOST = 'ens.codes'
