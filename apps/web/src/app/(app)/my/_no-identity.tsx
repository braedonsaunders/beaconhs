// Shared empty state for the personal "Workspace" (`/my/*`) views.
//
// Every personal view pivots on the signed-in user's own identity in the active
// tenant — either their membership (tenant_users row) or their linked person
// record. A platform super-admin browsing a tenant has neither, so instead of
// scattering slightly different "not a member" messages across each page we
// render one calm, consistent explanation everywhere.
//
//   reason='no-membership' — viewing as a platform admin with no member profile
//   reason='no-person'     — a member whose account isn't linked to a person row

import Link from 'next/link'
import { IdCard, ShieldUser } from 'lucide-react'
import { Button, EmptyState } from '@beaconhs/ui'

export function WorkspaceNoIdentity({
  reason,
  noun = 'records',
}: {
  reason: 'no-membership' | 'no-person'
  noun?: string
}) {
  if (reason === 'no-membership') {
    return (
      <EmptyState
        icon={<ShieldUser size={32} />}
        title="Personal view"
        description={`You're signed in as a platform administrator without a member profile in this tenant. The Workspace tracks an individual's own ${noun}, so there is nothing to show here. Switch to a tenant member to use it.`}
        action={
          <Link href="/dashboard">
            <Button variant="outline">Go to dashboard</Button>
          </Link>
        }
      />
    )
  }
  return (
    <EmptyState
      icon={<IdCard size={32} />}
      title="Account not linked"
      description={`Your account isn't linked to a person record yet. Ask an administrator to link it and your ${noun} will appear here.`}
      action={
        <Link href="/people">
          <Button variant="outline">Open people</Button>
        </Link>
      }
    />
  )
}
