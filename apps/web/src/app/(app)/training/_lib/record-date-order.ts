// Date ordering for the two-date training records (certificates: completed /
// expiry; skill tickets: granted / expiry) when their edits arrive from the
// device in one batch (see lib/record-sync).
//
// The record saver applies a batch's edits one at a time. A worker who moves
// both dates — say completed from May to July and expiry from June to next
// July — must not be refused because July sits after the *old* June expiry
// while the new expiry is in the same batch. So each date validates against
// the value its partner will hold once the batch settles:
// - the partner's queued value, when that edit will apply (it parses, and the
//   server still holds the value the device based it on, or already holds
//   the new value);
// - otherwise the partner's stored value.
// Both dates run the same check against each other, so a batch whose two new
// dates are out of order rejects both, and a batch where one edit conflicts
// validates the other against what is really stored.

import { jsonEqual } from '@/lib/offline-drafts/model'
import type { RecordSyncPatch } from '@/lib/offline-drafts/protocol'

export type PartnerDate = {
  /** The partner date's edit in this batch, if any. */
  patch: RecordSyncPatch | undefined
  /** The partner date as stored right now (including earlier writes in the batch). */
  current: string | null
  /** The partner's own parser (throws when the value is invalid). */
  parse: (wire: unknown) => string | null
}

const wire = (value: string | null): string => value ?? ''

/** The value the partner date will hold once this batch is applied. */
export function settledPartnerDate(partner: PartnerDate): string | null {
  const { patch, current, parse } = partner
  if (!patch) return current
  let next: string | null
  try {
    next = parse(patch.value)
  } catch {
    return current
  }
  // Already stored (an earlier write in this batch, or a retry).
  if (next === current) return current
  const currentWire = wire(current)
  if (jsonEqual(patch.base, currentWire)) return next
  try {
    if (wire(parse(patch.base)) === currentWire) return next
  } catch {
    // An unparseable base cannot match the stored value.
  }
  return current
}
