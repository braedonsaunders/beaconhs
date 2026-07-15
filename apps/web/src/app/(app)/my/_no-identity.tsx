import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'
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
  const tGenerated = useGeneratedTranslations()
  if (reason === 'no-membership') {
    return (
      <EmptyState
        icon={<ShieldUser size={32} />}
        title={tGenerated('m_0e04affa28a4aa')}
        description={tGenerated('m_109b5e22755a7e', { value0: noun })}
        action={
          <Link href="/dashboard">
            <Button variant="outline">
              <GeneratedText id="m_132d746a8ad9a0" />
            </Button>
          </Link>
        }
      />
    )
  }
  return (
    <EmptyState
      icon={<IdCard size={32} />}
      title={tGenerated('m_016d97d3e7d652')}
      description={tGenerated('m_0a4bfbb66afc6b', { value0: noun })}
      action={
        <Link href="/people">
          <Button variant="outline">
            <GeneratedText id="m_145ecc49015fb2" />
          </Button>
        </Link>
      }
    />
  )
}
