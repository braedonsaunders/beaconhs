// Bulk people CSV import — paste-or-drop CSV, preview rows with per-row
// validation, then create the people in one server-action call.
//
// The form is a client component because the parsing + preview happens
// before submit. This page just loads the lookup lists (departments, trades)
// for the matching hints and renders the form.

import { DetailHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { listImportLookups } from '../_actions/import'
import { ImportPeopleForm } from './_import-form'

export const metadata = { title: 'Import people' }
export const dynamic = 'force-dynamic'

export default async function ImportPeoplePage() {
  await requireRequestContext()
  const lookups = await listImportLookups()

  return (
    <PageContainer>
      <div className="max-w-5xl space-y-5">
        <DetailHeader
          back={{ href: '/people', label: 'Back to people' }}
          title="Import people from CSV"
          subtitle="One-off bulk add. For ongoing sync, prefer the NetSuite / BambooHR plugin."
        />
        <ImportPeopleForm knownDepartments={lookups.departments} knownTrades={lookups.trades} />
      </div>
    </PageContainer>
  )
}
