import { BaseError, ChainMismatchError, ContractFunctionRevertedError, InvalidParamsRpcError, UserRejectedRequestError } from 'viem'
import { chain } from './config'

const REVERT_TEXT: Record<string, string> = {
  CodeExists: 'This code already exists. Try again for a new one.',
  UnknownCode: 'Code not found.',
  CodeUsed: 'This code has already been used or cancelled.',
  BadAmount: 'That amount is outside the allowed range.',
  BadCodeSignature: 'The code signature did not match. Check the code.',
  SignatureExpired: 'This confirmation timed out. Try again.',
  NotRenewer: 'That renewer is not allowed.',
  WrongRelayer: 'This confirmation was signed for a different wallet.',
  BadRenewals: 'Too many names for one code.',
  InsufficientBalance: 'That is more than the code is worth.',
  NotBuyer: 'Only the buyer can cancel this code.',
  IsPaused: 'New claim codes are paused right now.',
  ERC20InsufficientBalance: 'Not enough USDC in your wallet.',
  ERC20InsufficientAllowance: 'The ENS price changed since your quote. Try again.',
}

/** A short, human message for wallet and contract errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return 'You cancelled the request in your wallet.'
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName
      if (name && REVERT_TEXT[name]) return REVERT_TEXT[name]
      if (revert.reason) return revert.reason
    }
    if (/insufficient funds/i.test(err.message)) return 'Your wallet needs a little ETH for the network fee.'
    const wrongNetwork = `Your wallet is on a different network. Switch it to ${chain.name} and try again.`
    if (err.walk((e) => e instanceof ChainMismatchError)) return wrongNetwork
    // A wallet that refuses a request outright gives its reason in its own words, which the library's
    // one-line summary ("Invalid parameters were provided to the RPC method") leaves out.
    if (err.walk((e) => e instanceof InvalidParamsRpcError)) {
      const why = err.details?.trim()
      if (why && /chain ?id|network/i.test(why)) return wrongNetwork
      // MetaMask's wording when it shares no account with the site on the network the request is for.
      if (why && /must provide an Ethereum address/i.test(why)) return `Your wallet hasn’t allowed this site to use ${chain.name}. Add it in the wallet’s permissions for this site, then try again.`
      if (why && /must provide a permitted Ethereum address/i.test(why)) return 'Your wallet isn’t sharing this account with the site. Log out here, then log in again.'
      if (why) return `Your wallet refused the request: ${why.slice(0, 200)}`
    }
    return err.shortMessage
  }
  if ((err as { code?: number })?.code === 4001) return 'You cancelled the request in your wallet.'
  return err instanceof Error ? err.message : String(err)
}
