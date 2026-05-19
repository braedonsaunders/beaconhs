import Link from 'next/link'
import { asc, eq, isNull } from 'drizzle-orm'
import {
  Badge,
  Button,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { orgUnits, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { mergeHref, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import {
  ASSIGNMENT_KIND_LABELS,
  type AssignmentKind,
  type AssignmentOption,
  breakdownDocumentAssignment,
  breakdownInspectionAssignment,
  breakdownToolboxAssignment,
  breakdownTrainingAssignment,
  computeAgingSummary,
  computeSiteCompliance,
  listAssignmentsForKind,
  listAssignmentsForPerson,
} from './_lib'

export const metadata = { title: 'Compliance' }
export const dynamic = 'force-dynamic'

const TABS = ['entity', 'person', 'site', 'aging'] as const
type Tab = (typeof TABS)[number]

const KIND_OPTIONS: { value: AssignmentKind; label: string }[] = [
  { value: 'toolbox', label: ASSIGNMENT_KIND_LABELS.toolbox },
  { value: 'inspection', label: ASSIGNMENT_KIND_LABELS.inspection },
  { value: 'document', label: ASSIGNMENT_KIND_LABELS.document },
  { value: 'training_assessment', label: ASSIGNMENT_KIND_LABELS.training_assessment },
]

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const tab = pickActiveTab<Tab>(sp, TABS, 'entity')
  const ctx = await requireRequestContext()

  const header = (
    <>
      <PageHeader
        title="Compliance"
        description="Cross-module compliance rollup: by entity, by person, by site, and aging."
      />
      <TabNav
        basePath="/compliance"
        currentParams={sp}
        tabs={[
          { key: 'entity', label: 'By entity' },
          { key: 'person', label: 'By person' },
          { key: 'site', label: 'By site / project' },
          { key: 'aging', label: 'Aging' },
        ]}
        active={tab}
      />
    </>
  )

  if (tab === 'entity') {
    return (
      <ListPageLayout header={header}>
        <EntityTab sp={sp} ctx={ctx} />
      </ListPageLayout>
    )
  }
  if (tab === 'person') {
    return (
      <ListPageLayout header={header}>
        <PersonTab sp={sp} ctx={ctx} />
      </ListPageLayout>
    )
  }
  if (tab === 'site') {
    return (
      <ListPageLayout header={header}>
        <SiteTab sp={sp} ctx={ctx} />
      </ListPageLayout>
    )
  }
  return (
    <ListPageLayout header={header}>
      <AgingTab ctx={ctx} />
    </ListPageLayout>
  )
}

// ============================================================
// Tab: by entity
// ============================================================

async function EntityTab({
  sp,
  ctx,
}: {
  sp: Record<string, string | string[] | undefined>
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
}) {
  const rawKind = pickString(sp.kind)
  const kind: AssignmentKind = (KIND_OPTIONS.some((k) => k.value === rawKind)
    ? rawKind
    : 'toolbox') as AssignmentKind
  const assignmentId = pickString(sp.assignment)

  // Pull *all* options across every kind so we can render a rollup matrix
  // when no specific assignment is picked. This is the headline value
  // proposition of the entity tab — see who/where the gaps are at a glance.
  const [toolboxOptions, inspectionOptions, documentOptions, trainingOptions] = await Promise.all([
    listAssignmentsForKind(ctx, 'toolbox'),
    listAssignmentsForKind(ctx, 'inspection'),
    listAssignmentsForKind(ctx, 'document'),
    listAssignmentsForKind(ctx, 'training_assessment'),
  ])
  const optionsByKind: Record<AssignmentKind, AssignmentOption[]> = {
    toolbox: toolboxOptions,
    inspection: inspectionOptions,
    document: documentOptions,
    training_assessment: trainingOptions,
  }
  const options = optionsByKind[kind]
  const selected = assignmentId
    ? options.find((o) => o.id === assignmentId) ?? null
    : null

  const breakdown = selected
    ? kind === 'document'
      ? await breakdownDocumentAssignment(ctx, selected.id)
      : kind === 'inspection'
        ? await breakdownInspectionAssignment(ctx, selected.id)
        : kind === 'training_assessment'
          ? await breakdownTrainingAssignment(ctx, selected.id)
          : await breakdownToolboxAssignment(ctx, selected.id)
    : null

  // When no entity is selected, compute a global rollup across every active
  // assignment in the active kind. That gives the rollup table a stable
  // 4-column shape (assignment / completed / total / %) that mirrors the
  // legacy "all entities" dashboard.
  const rollup = selected ? null : await computeKindRollup(ctx, kind, options)

  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="entity" />
        <div className="min-w-[240px]">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Assignment kind
          </label>
          <Select name="kind" defaultValue={kind}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} ({optionsByKind[o.value].length})
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[320px] flex-1">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Assignment (optional — leave blank for rollup)
          </label>
          <Select name="assignment" defaultValue={assignmentId ?? ''}>
            <option value="">— All {ASSIGNMENT_KIND_LABELS[kind].toLowerCase()} assignments —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.notes ? ` · ${o.notes}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">Run</Button>
      </form>

      {selected && breakdown ? (
        <div className="space-y-4">
          <SummaryStrip
            percent={breakdown.percent}
            totals={breakdown.totals}
            title={selected.label}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Completed</TableHead>
                {breakdown.rows.some((r) => r.expected != null) ? (
                  <>
                    <TableHead>Count</TableHead>
                    <TableHead>Expected</TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {breakdown.rows.map((r, i) => (
                <TableRow key={r.personId}>
                  <TableCell className="text-slate-500">{i + 1}</TableCell>
                  <TableCell className="text-slate-900">{r.name}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-slate-700">{r.completedOn ?? '—'}</TableCell>
                  {breakdown.rows.some((rr) => rr.expected != null) ? (
                    <>
                      <TableCell className="text-slate-700">{r.count ?? '—'}</TableCell>
                      <TableCell className="text-slate-700">{r.expected ?? '—'}</TableCell>
                    </>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : rollup && rollup.length > 0 ? (
        <div className="space-y-4">
          <RollupSummaryStrip
            rows={rollup}
            kindLabel={ASSIGNMENT_KIND_LABELS[kind]}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assignment</TableHead>
                <TableHead className="w-28">Completed</TableHead>
                <TableHead className="w-28">Audience</TableHead>
                <TableHead className="w-28">Overdue</TableHead>
                <TableHead>Compliance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rollup.map((r) => (
                <TableRow key={`${r.kind}::${r.id}`}>
                  <TableCell>
                    <Link
                      href={`/compliance?tab=entity&kind=${r.kind}&assignment=${r.id}` as any}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.label}
                    </Link>
                    {r.notes ? (
                      <div className="text-xs text-slate-500 line-clamp-1">{r.notes}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular-nums text-slate-700">
                    {r.completed.toLocaleString()}
                  </TableCell>
                  <TableCell className="tabular-nums text-slate-700">
                    {r.total.toLocaleString()}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {r.overdue > 0 ? (
                      <Badge variant="destructive">{r.overdue}</Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 max-w-xs">
                        <PercentBar percent={r.percent} />
                      </div>
                      <span className="text-xs tabular-nums text-slate-600 min-w-[3rem] text-right">
                        {r.percent}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
          No active {ASSIGNMENT_KIND_LABELS[kind].toLowerCase()} assignments to roll up.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cross-assignment rollup — used when no specific assignment is selected on
// the entity tab. Computes a per-assignment summary by re-using the per-kind
// breakdown helpers in `_lib.ts` and reducing each into its scalar metrics.
// ---------------------------------------------------------------------------

type RollupRow = {
  kind: AssignmentKind
  id: string
  label: string
  notes: string | null
  total: number
  completed: number
  overdue: number
  percent: number
}

async function computeKindRollup(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  kind: AssignmentKind,
  options: AssignmentOption[],
): Promise<RollupRow[]> {
  // Limit to a reasonable number — the breakdown calls hit the DB each time.
  const sliced = options.slice(0, 50)
  const results = await Promise.all(
    sliced.map(async (o) => {
      const b =
        kind === 'document'
          ? await breakdownDocumentAssignment(ctx, o.id)
          : kind === 'inspection'
            ? await breakdownInspectionAssignment(ctx, o.id)
            : kind === 'training_assessment'
              ? await breakdownTrainingAssignment(ctx, o.id)
              : await breakdownToolboxAssignment(ctx, o.id)
      return {
        kind,
        id: o.id,
        label: o.label,
        notes: o.notes,
        total: b.totals.total,
        completed: b.totals.completed,
        overdue: b.totals.overdue,
        percent: b.percent,
      } satisfies RollupRow
    }),
  )
  // Sort by overdue (desc) then by percent (asc) so the worst offenders rise
  // to the top.
  results.sort((a, b) => b.overdue - a.overdue || a.percent - b.percent)
  return results
}

function RollupSummaryStrip({
  rows,
  kindLabel,
}: {
  rows: RollupRow[]
  kindLabel: string
}) {
  const totalAudience = rows.reduce((s, r) => s + r.total, 0)
  const totalCompleted = rows.reduce((s, r) => s + r.completed, 0)
  const totalOverdue = rows.reduce((s, r) => s + r.overdue, 0)
  const totalPercent = totalAudience === 0 ? 0 : Math.round((totalCompleted / totalAudience) * 100)
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">{kindLabel} assignments</div>
        <div className="mt-1 text-2xl font-semibold text-slate-900">{rows.length}</div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Total audience</div>
        <div className="mt-1 text-2xl font-semibold text-slate-900">
          {totalAudience.toLocaleString()}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Overdue</div>
        <div className="mt-1 text-2xl font-semibold text-red-700">
          {totalOverdue.toLocaleString()}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Overall compliance</div>
        <div className="mt-1 text-2xl font-semibold text-slate-900">{totalPercent}%</div>
      </div>
    </div>
  )
}

// ============================================================
// Tab: by person
// ============================================================

async function PersonTab({
  sp,
  ctx,
}: {
  sp: Record<string, string | string[] | undefined>
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
}) {
  const personId = pickString(sp.person)
  const peopleOptions = await ctx.db((tx) =>
    tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        jobTitle: people.jobTitle,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(2000),
  )

  const rows = personId ? await listAssignmentsForPerson(ctx, personId) : []
  const totals = {
    total: rows.length,
    completed: rows.filter((r) => r.status === 'completed').length,
    overdue: rows.filter((r) => r.status === 'overdue').length,
    pending: rows.filter((r) => r.status === 'pending' || r.status === 'in_progress').length,
  }
  const percent = totals.total === 0 ? 0 : Math.round((totals.completed / totals.total) * 100)

  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="person" />
        <div className="min-w-[320px] flex-1">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Person
          </label>
          <Select name="person" defaultValue={personId ?? ''}>
            <option value="">— Select —</option>
            {peopleOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {`${p.lastName ?? ''}${p.lastName ? ', ' : ''}${p.firstName ?? ''}`.trim() ||
                  '(unnamed)'}
                {p.jobTitle ? ` — ${p.jobTitle}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">Run</Button>
      </form>

      {!personId ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
          Pick a person above to see every assignment they are scoped into.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700">
          This person isn&apos;t in any active assignments across toolbox, inspections,
          documents, or training.
        </div>
      ) : (
        <div className="space-y-4">
          <SummaryStrip percent={percent} totals={totals} title="Across all kinds" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Assignment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.kind}:${r.assignmentId}:${i}`}>
                  <TableCell>
                    <Badge variant="secondary">{ASSIGNMENT_KIND_LABELS[r.kind]}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-900">{r.label}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-slate-700">{r.dueOn ?? '—'}</TableCell>
                  <TableCell className="text-slate-700">{r.completedOn ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Tab: by site / project
// ============================================================

async function SiteTab({
  sp,
  ctx,
}: {
  sp: Record<string, string | string[] | undefined>
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
}) {
  const siteFilter = pickString(sp.site) ?? null
  const sites = await ctx.db((tx) =>
    tx
      .select({ id: orgUnits.id, name: orgUnits.name, level: orgUnits.level })
      .from(orgUnits)
      .where(isNull(orgUnits.deletedAt))
      .orderBy(asc(orgUnits.name)),
  )
  const summary = await computeSiteCompliance(ctx, siteFilter)

  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="site" />
        <div className="min-w-[320px] flex-1">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Site / project
          </label>
          <Select name="site" defaultValue={siteFilter ?? ''}>
            <option value="">All sites / projects</option>
            {sites
              .filter((s) => s.level === 'site' || s.level === 'project')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.level})
                </option>
              ))}
          </Select>
        </div>
        <Button type="submit">Run</Button>
      </form>

      {summary.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
          No sites or projects to report on.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Site / project</TableHead>
              <TableHead>Inspections completed</TableHead>
              <TableHead>Inspections expected</TableHead>
              <TableHead>Toolbox closed (30d)</TableHead>
              <TableHead>Inspection compliance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.map((r) => {
              const pct =
                r.inspectionsExpected === 0
                  ? 0
                  : Math.round((r.inspectionsCompleted / r.inspectionsExpected) * 100)
              return (
                <TableRow key={r.siteId}>
                  <TableCell className="text-slate-900">{r.siteName}</TableCell>
                  <TableCell className="text-slate-700">{r.inspectionsCompleted}</TableCell>
                  <TableCell className="text-slate-700">{r.inspectionsExpected}</TableCell>
                  <TableCell className="text-slate-700">{r.toolboxClosed}</TableCell>
                  <TableCell>
                    <PercentBar percent={pct} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

// ============================================================
// Tab: aging summary
// ============================================================

async function AgingTab({
  ctx,
}: {
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
}) {
  const rows = await computeAgingSummary(ctx)

  // Pivot rows into a matrix [kind][bucket] → count for the table render.
  const KINDS: AssignmentKind[] = ['toolbox', 'inspection', 'document', 'training_assessment']
  const matrix: Record<AssignmentKind, Record<string, number>> = {
    toolbox: { '0_7': 0, '7_30': 0, '30_plus': 0 },
    inspection: { '0_7': 0, '7_30': 0, '30_plus': 0 },
    document: { '0_7': 0, '7_30': 0, '30_plus': 0 },
    training_assessment: { '0_7': 0, '7_30': 0, '30_plus': 0 },
  }
  for (const r of rows) {
    const bucket = matrix[r.kind]
    bucket[r.bucket] = (bucket[r.bucket] ?? 0) + r.count
  }
  const totalsByKind: Record<AssignmentKind, number> = {
    toolbox: 0,
    inspection: 0,
    document: 0,
    training_assessment: 0,
  }
  for (const k of KINDS) {
    totalsByKind[k] = (matrix[k]['0_7'] ?? 0) + (matrix[k]['7_30'] ?? 0) + (matrix[k]['30_plus'] ?? 0)
  }
  const grandTotal = Object.values(totalsByKind).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {KINDS.map((k) => (
          <div
            key={k}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {ASSIGNMENT_KIND_LABELS[k]}
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {totalsByKind[k]}
            </div>
            <div className="text-xs text-slate-500">overdue items</div>
          </div>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kind</TableHead>
            <TableHead>0 – 7 days overdue</TableHead>
            <TableHead>7 – 30 days overdue</TableHead>
            <TableHead>30+ days overdue</TableHead>
            <TableHead>Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {KINDS.map((k) => (
            <TableRow key={k}>
              <TableCell>
                <Badge variant="secondary">{ASSIGNMENT_KIND_LABELS[k]}</Badge>
              </TableCell>
              <TableCell>
                <AgingCell count={matrix[k]['0_7'] ?? 0} tone="warning" />
              </TableCell>
              <TableCell>
                <AgingCell count={matrix[k]['7_30'] ?? 0} tone="warning" />
              </TableCell>
              <TableCell>
                <AgingCell count={matrix[k]['30_plus'] ?? 0} tone="danger" />
              </TableCell>
              <TableCell className="font-semibold text-slate-900">{totalsByKind[k]}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="text-slate-700">Total</TableCell>
            <TableCell className="text-slate-700">
              {KINDS.reduce((s, k) => s + (matrix[k]['0_7'] ?? 0), 0)}
            </TableCell>
            <TableCell className="text-slate-700">
              {KINDS.reduce((s, k) => s + (matrix[k]['7_30'] ?? 0), 0)}
            </TableCell>
            <TableCell className="text-slate-700">
              {KINDS.reduce((s, k) => s + (matrix[k]['30_plus'] ?? 0), 0)}
            </TableCell>
            <TableCell className="font-semibold text-slate-900">{grandTotal}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      {grandTotal === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-sm text-slate-500">
          Nothing overdue — nice job.
        </div>
      ) : null}
    </div>
  )
}

// ============================================================
// Shared bits
// ============================================================

function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <Badge variant="success">Completed</Badge>
  if (status === 'overdue') return <Badge variant="destructive">Overdue</Badge>
  if (status === 'in_progress') return <Badge variant="warning">In progress</Badge>
  return <Badge variant="secondary">Pending</Badge>
}

function SummaryStrip({
  percent,
  totals,
  title,
}: {
  percent: number
  totals: { total: number; completed: number; overdue: number; pending: number }
  title: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm text-slate-500">{title}</div>
          <div className="text-3xl font-semibold text-slate-900">{percent}%</div>
          <div className="text-xs text-slate-500">
            {totals.completed} of {totals.total} completed · {totals.overdue} overdue ·{' '}
            {totals.pending} pending
          </div>
        </div>
        <div className="w-1/2 max-w-xl">
          <PercentBar percent={percent} large />
        </div>
      </div>
    </div>
  )
}

function PercentBar({ percent, large = false }: { percent: number; large?: boolean }) {
  const tone = percent >= 80 ? 'bg-green-500' : percent >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-slate-100 ${large ? 'h-3' : 'h-2'}`}>
      <div
        className={`absolute inset-y-0 left-0 ${tone}`}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  )
}

function AgingCell({ count, tone }: { count: number; tone: 'warning' | 'danger' }) {
  if (count === 0) return <span className="text-slate-400">0</span>
  return (
    <Badge variant={tone === 'danger' ? 'destructive' : 'warning'}>{count}</Badge>
  )
}
