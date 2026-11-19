import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  Cancelled,
  Created,
  FeesSwept,
  MaxCodeAmountSet,
  OwnershipTransferred,
  OwnershipTransferStarted,
  Paused,
  Redeemed,
  RefundClaimed,
  RefundOwed,
  RenewerAdded,
  RenewerCancelled,
  RenewerProposed,
  RenewerRemoved,
  Unpaused,
} from '../generated/ClaimCodeVault/ClaimCodeVault'
import { AdminChange, Cancellation, FeeSweep, Purchase, Redemption, Refund, RenewerChange } from '../generated/schema'

/** One id per log: the transaction and the log's position in its block. */
function idOf(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32())
}

export function handleCreated(event: Created): void {
  const e = new Purchase(idOf(event))
  e.batch = event.params.id
  e.buyer = event.params.buyer
  e.amount = event.params.amount
  e.count = event.params.count
  e.root = event.params.root
  e.block = event.block.number
  e.logIndex = event.logIndex
  e.timestamp = event.block.timestamp
  e.tx = event.transaction.hash
  e.save()
}

export function handleRedeemed(event: Redeemed): void {
  const e = new Redemption(idOf(event))
  e.batch = event.params.id
  e.code = event.params.code
  e.index = event.params.index
  const renewers: Bytes[] = []
  const labels: string[] = []
  const durations: BigInt[] = []
  const renewals = event.params.renewals
  for (let i = 0; i < renewals.length; i++) {
    renewers.push(renewals[i].renewer)
    labels.push(renewals[i].label)
    durations.push(renewals[i].duration)
  }
  e.renewers = renewers
  e.labels = labels
  e.durations = durations
  e.spent = event.params.spent
  e.refunded = event.params.refunded
  e.sender = event.transaction.from
  const receipt = event.receipt
  e.gasUsed = receipt ? receipt.gasUsed : BigInt.zero()
  e.block = event.block.number
  e.logIndex = event.logIndex
  e.timestamp = event.block.timestamp
  e.tx = event.transaction.hash
  e.save()
}

export function handleCancelled(event: Cancelled): void {
  const e = new Cancellation(idOf(event))
  e.batch = event.params.id
  e.buyer = event.params.buyer
  e.mask = event.params.mask
  e.refunded = event.params.refunded
  e.block = event.block.number
  e.logIndex = event.logIndex
  e.timestamp = event.block.timestamp
  e.tx = event.transaction.hash
  e.save()
}

export function handleFeesSwept(event: FeesSwept): void {
  const e = new FeeSweep(idOf(event))
  e.to = event.params.to
  e.amount = event.params.amount
  e.block = event.block.number
  e.logIndex = event.logIndex
  e.timestamp = event.block.timestamp
  e.tx = event.transaction.hash
  e.save()
}

function refund(event: ethereum.Event, kind: string, buyer: Bytes, amount: BigInt): void {
  const e = new Refund(idOf(event))
  e.kind = kind
  e.buyer = buyer
  e.amount = amount
  e.block = event.block.number
  e.logIndex = event.logIndex
  e.timestamp = event.block.timestamp
  e.tx = event.transaction.hash
  e.save()
}

export function handleRefundOwed(event: RefundOwed): void {
  refund(event, 'owed', event.params.buyer, event.params.amount)
}

export function handleRefundClaimed(event: RefundClaimed): void {
  refund(event, 'claimed', event.params.buyer, event.params.amount)
}

function renewer(event: ethereum.Event, kind: string, address: Bytes, activatesAt: BigInt | null): void {
  const e = new RenewerChange(idOf(event))
  e.kind = kind
  e.renewer = address
  e.activatesAt = activatesAt
  e.block = event.block.number
  e.logIndex = event.logIndex
  e.timestamp = event.block.timestamp
  e.tx = event.transaction.hash
  e.save()
}

export function handleRenewerProposed(event: RenewerProposed): void {
  renewer(event, 'proposed', event.params.renewer, event.params.activatesAt)
}

export function handleRenewerAdded(event: RenewerAdded): void {
  renewer(event, 'added', event.params.renewer, null)
}

export function handleRenewerCancelled(event: RenewerCancelled): void {
  renewer(event, 'cancelled', event.params.renewer, null)
}

export function handleRenewerRemoved(event: RenewerRemoved): void {
  renewer(event, 'removed', event.params.renewer, null)
}

function admin(event: ethereum.Event, kind: string, amount: BigInt | null, from: Bytes | null, to: Bytes | null): void {
  const e = new AdminChange(idOf(event))
  e.kind = kind
  e.amount = amount
  e.from = from
  e.to = to
  e.block = event.block.number
  e.logIndex = event.logIndex
  e.timestamp = event.block.timestamp
  e.tx = event.transaction.hash
  e.save()
}

export function handlePaused(event: Paused): void {
  admin(event, 'paused', null, null, null)
}

export function handleUnpaused(event: Unpaused): void {
  admin(event, 'unpaused', null, null, null)
}

export function handleMaxCodeAmountSet(event: MaxCodeAmountSet): void {
  admin(event, 'maxCodeAmount', event.params.amount, null, null)
}

export function handleOwnershipTransferStarted(event: OwnershipTransferStarted): void {
  admin(event, 'ownershipStarted', null, event.params.previousOwner, event.params.newOwner)
}

export function handleOwnershipTransferred(event: OwnershipTransferred): void {
  admin(event, 'ownershipTransferred', null, event.params.previousOwner, event.params.newOwner)
}
