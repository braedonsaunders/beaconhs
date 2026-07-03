import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { ClipboardCheck } from 'lucide-react'
import { Button, Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { inspectionTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { startInspection } from '../_actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Start inspection' }

// The full-page "new inspection" form is gone — picking a type happens in the
// records-list flyout, and everything else is captured inline on the record.
//
// A `?typeId=` deep link (e.g. a compliance obligation's "Start inspection"
// action) lands here on a plain GET, so it must NOT create anything by itself:
// prefetches, link scanners, and bookmarks would otherwise mint phantom draft
// records, audits, and flow runs. It renders a one-click confirmation whose
// button POSTs the existing startInspection server action instead.
export default async function NewInspectionConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const typeId = pickString(sp.typeId)
  if (!typeId) redirect('/inspections/records?drawer=new')

  const ctx = await requireRequestContext()
  const [type] = await ctx.db((tx) =>
    tx
      .select({
        id: inspectionTypes.id,
        name: inspectionTypes.name,
        description: inspectionTypes.description,
      })
      .from(inspectionTypes)
      .where(and(eq(inspectionTypes.id, typeId), isNull(inspectionTypes.deletedAt)))
      .limit(1),
  )
  if (!type) redirect('/inspections/records?drawer=new')

  return (
    <PageContainer>
      <div className="mx-auto max-w-lg space-y-6">
        <DetailHeader
          back={{ href: '/inspections/records', label: 'Back to inspection records' }}
          title="Start inspection"
        />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {type.name}
              </div>
              {type.description ? (
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {type.description}
                </p>
              ) : null}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Starting creates a draft record immediately. Date, site, foreman, and notes are
              captured on the record itself.
            </p>
            <form action={startInspection}>
              <input type="hidden" name="typeId" value={type.id} />
              <Button type="submit">
                <ClipboardCheck size={14} /> Start inspection
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
