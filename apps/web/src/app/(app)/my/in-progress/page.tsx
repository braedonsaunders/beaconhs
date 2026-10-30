import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
// "In progress" — a card per unfinished entry the current user authored across
// modules (journals, hazard assessments, incidents, inspections). Each card
// links into the entry to resume it. Same data as the dashboard "In progress"
// widget and the Workspace tile (see loadInProgressEntries).

import Link from 'next/link'
import { PencilLine } from 'lucide-react'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { WorkspaceEntryCards } from '@/components/workspace-entry-cards'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadInProgressEntries } from '../../dashboard/_metrics'
import { WorkspaceNoIdentity } from '../_no-identity'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a03b06872ffd9') }
}
export const dynamic = 'force-dynamic'

export default async function MyInProgressPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  const membershipId = ctx.membership?.id ?? null

  const header = (
    <PageHeader
      back={{ href: '/my', label: 'Workspace' }}
      title={tGenerated('m_1a03b06872ffd9')}
      description={tGenerated('m_1844c2816e2bdc')}
    />
  )

  // Without a membership (super-admin viewing-as) there's nothing to scope to.
  if (!membershipId) {
    return (
      <PageContainer>
        <div className="space-y-5">
          <GeneratedValue value={header} />
          <WorkspaceNoIdentity reason="no-membership" noun="unfinished entries" />
        </div>
      </PageContainer>
    )
  }

  const entries = await ctx.db((tx) => loadInProgressEntries(tx, membershipId))

  return (
    <PageContainer>
      <div className="space-y-5">
        <GeneratedValue value={header} />

        <GeneratedValue
          value={
            entries.length === 0 ? (
              <EmptyState
                icon={<PencilLine size={32} />}
                title={tGenerated('m_03cdaafe508e1f')}
                description={tGenerated('m_1b464e6d5939e2')}
                action={
                  <Link href="/dashboard">
                    <Button variant="outline">
                      <GeneratedText id="m_132d746a8ad9a0" />
                    </Button>
                  </Link>
                }
              />
            ) : (
              <WorkspaceEntryCards
                entries={entries}
                action="Resume"
                timezone={ctx.timezone}
                locale={ctx.locale}
              />
            )
          }
        />
      </div>
    </PageContainer>
  )
}
