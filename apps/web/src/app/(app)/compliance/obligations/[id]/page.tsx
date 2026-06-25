import { notFound } from 'next/navigation'
import {
  Badge,
  DetailHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { pickString } from '@/lib/list-params'
import { EVERYONE_KEY, type AudienceItem } from '@/components/audience-picker'
import { recurrenceValueFromStored } from '@/components/recurrence'
import { SummaryStrip } from '../../_shared'
import { KIND_META, kindLabel, type ObligationKind } from '../_meta'
import { obligationCompliance } from '../_data'
import { loadObligationFormOptions } from '../_form-options'
import { ObligationDetailActions } from './_detail-actions'
import { ObligationEditDrawer, type ObligationEditData } from './_edit-drawer'

export const metadata = { title: 'Obligation' }
export const dynamic = 'force-dynamic'

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <Badge variant="success">Completed</Badge>
  if (status === 'overdue') return <Badge variant="destructive">Overdue</Badge>
  if (status === 'expiring') return <Badge variant="destructive">Expiring</Badge>
  if (status === 'in_progress') return <Badge variant="warning">In progress</Badge>
  return <Badge variant="secondary">Pending</Badge>
}

function cadence(rec: {
  kind: string
  frequency?: string
  quantity?: number
  cron?: string
  dueOn?: string
}): string {
  if (rec.kind === 'frequency') return `${rec.quantity ?? 1}/${rec.frequency ?? 'week'}`
  if (rec.kind === 'cron') return rec.cron ? `cron ${rec.cron}` : '—'
  if (rec.kind === 'one_time') return rec.dueOn ? `due ${rec.dueOn}` : 'one-off'
  if (rec.kind === 'expiry') return 'continuous'
  return rec.kind
}

export default async function ObligationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.read')
  const data = await obligationCompliance(ctx, id)
  if (!data) notFound()
  const { obligation: ob, audience, result } = data
  const hasCounts = result.rows.some((r) => r.expected != null)
  const subjectNoun =
    ob.subjectKind === 'per_record'
      ? 'Record'
      : ob.subjectKind === 'per_task'
        ? 'Sign-off'
        : 'Person'

  const canManage = can(ctx, 'compliance.manage')
  // Only kinds the unified form can author are editable (rules out future
  // ETL-only source modules); such obligations stay manageable (pause/delete).
  const editable = canManage && ob.sourceModule in KIND_META
  const basePath = `/compliance/obligations/${ob.id}`

  // Edit flyout — opened via ?drawer=edit. Reuses the audience already loaded
  // for the compliance evaluation; the picker uses the EVERYONE_KEY sentinel
  // where stored rows use the everyone kind.
  let edit: ObligationEditData | null = null
  if (editable && pickString(sp.drawer) === 'edit') {
    const { targets, audienceOptions } = await loadObligationFormOptions(ctx)
    const initialAudience: AudienceItem[] = audience.map((a) => ({
      type: a.kind,
      entityKey: a.kind === 'everyone' ? EVERYONE_KEY : a.entityKey,
    }))
    edit = {
      kind: ob.sourceModule as ObligationKind,
      targets,
      audienceOptions,
      initial: {
        id: ob.id,
        title: ob.title,
        notes: ob.notes,
        audience: initialAudience,
        recurrence: recurrenceValueFromStored(ob.recurrence),
        targetRef: ob.targetRef ?? {},
      },
    }
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: '/compliance/obligations', label: 'Back to obligations' }}
          title={ob.title}
          subtitle={`${kindLabel(ob.sourceModule)} · ${cadence(ob.recurrence)}${
            ob.subjectKind === 'per_person'
              ? ` · ${audience.length || 'everyone'} audience target(s)`
              : ''
          }`}
          actions={
            <ObligationDetailActions
              id={ob.id}
              enabled={ob.status === 'active'}
              canManage={canManage}
              canEdit={editable}
            />
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{kindLabel(ob.sourceModule)}</Badge>
          <Badge variant={ob.status === 'active' ? 'success' : 'secondary'}>
            {ob.status === 'active' ? 'Active' : ob.status === 'paused' ? 'Disabled' : ob.status}
          </Badge>
        </div>

        {ob.notes ? <p className="text-sm text-slate-600 dark:text-slate-400">{ob.notes}</p> : null}

        <SummaryStrip percent={result.percent} totals={result.totals} title="Compliance" />

        {result.rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
            No subjects resolved for this obligation.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{subjectNoun}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Completed</TableHead>
                {hasCounts ? (
                  <>
                    <TableHead>Count</TableHead>
                    <TableHead>Expected</TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r, i) => (
                <TableRow key={r.key}>
                  <TableCell className="text-slate-500 dark:text-slate-400">{i + 1}</TableCell>
                  <TableCell className="text-slate-900 dark:text-slate-100">{r.label}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-slate-700 dark:text-slate-300">
                    {r.dueOn ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-700 dark:text-slate-300">
                    {r.completedOn ?? '—'}
                  </TableCell>
                  {hasCounts ? (
                    <>
                      <TableCell className="text-slate-700 dark:text-slate-300">
                        {r.count ?? '—'}
                      </TableCell>
                      <TableCell className="text-slate-700 dark:text-slate-300">
                        {r.expected ?? '—'}
                      </TableCell>
                    </>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <ObligationEditDrawer edit={edit} closeHref={basePath} />
      </div>
    </PageContainer>
  )
}
