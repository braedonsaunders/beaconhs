import Link from 'next/link'
import { asc, desc, eq, isNotNull, or, sql } from 'drizzle-orm'
import { AlertTriangle, ClipboardCheck } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  equipmentItems,
  equipmentTypes,
  formResponses,
  formTemplates,
  orgUnits,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Equipment inspections' }
export const dynamic = 'force-dynamic'

// Pre-use is considered overdue when there is no last_pre_use_inspection_at, OR
// when it was more than 24h ago AND the item requires pre-use checks.
const PRE_USE_HOURS = 24

function startOfTodayIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString()
}

export default async function EquipmentInspectionsPage() {
  const ctx = await requireRequestContext()
  const today = startOfTodayIso()
  const preUseCutoff = new Date(Date.now() - PRE_USE_HOURS * 60 * 60 * 1000)

  const { overdueAnnual, overduePreUse, recent, templates } = await ctx.db(async (tx) => {
    const [annual, preUse, completions, tmpls] = await Promise.all([
      tx
        .select({
          item: equipmentItems,
          type: equipmentTypes,
          site: orgUnits,
        })
        .from(equipmentItems)
        .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
        .where(
          sql`${equipmentItems.requiresAnnualInspection} = true
              AND (${equipmentItems.nextAnnualInspectionDue} IS NULL
                   OR ${equipmentItems.nextAnnualInspectionDue} <= ${today}::date)`,
        )
        .orderBy(asc(equipmentItems.nextAnnualInspectionDue))
        .limit(200),
      tx
        .select({
          item: equipmentItems,
          type: equipmentTypes,
          site: orgUnits,
        })
        .from(equipmentItems)
        .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
        .where(
          sql`${equipmentItems.requiresPreUseInspection} = true
              AND (${equipmentItems.lastPreUseInspectionAt} IS NULL
                   OR ${equipmentItems.lastPreUseInspectionAt} < ${preUseCutoff.toISOString()})`,
        )
        .orderBy(asc(equipmentItems.lastPreUseInspectionAt))
        .limit(200),
      tx
        .select({
          response: formResponses,
          template: formTemplates,
          item: equipmentItems,
        })
        .from(formResponses)
        .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
        .leftJoin(equipmentItems, eq(equipmentItems.id, formResponses.sourceEntityId))
        .where(
          sql`${formResponses.sourceEntityType} = 'equipment'
              AND (${formTemplates.moduleBinding} = 'equipment_inspection'
                   OR ${formTemplates.category} = 'inspection')
              AND ${formResponses.submittedAt} IS NOT NULL`,
        )
        .orderBy(desc(formResponses.submittedAt))
        .limit(50),
      tx
        .select({ id: formTemplates.id, key: formTemplates.key, name: formTemplates.name })
        .from(formTemplates)
        .where(
          or(
            eq(formTemplates.moduleBinding, 'equipment_inspection'),
            eq(formTemplates.category, 'inspection'),
          ),
        )
        .orderBy(asc(formTemplates.name))
        .limit(200),
    ])
    return {
      overdueAnnual: annual,
      overduePreUse: preUse,
      recent: completions,
      templates: tmpls,
    }
  })

  const templatesByKey = new Map(templates.map((t) => [t.key, t]))
  const fallbackTemplate = templates[0] ?? null

  function inspectionLink(item: (typeof overduePreUse)[number]['item']): string | null {
    const key = item.preUseInspectionTemplateKey ?? null
    const tmpl = (key && templatesByKey.get(key)) || fallbackTemplate
    if (!tmpl) return null
    return `/forms/templates/${tmpl.id}/fill?sourceEntityType=equipment&sourceEntityId=${item.id}`
  }

  function browseLink(item: (typeof overdueAnnual)[number]['item']): string {
    return `/forms?category=inspection&sourceEntityType=equipment&sourceEntityId=${item.id}`
  }

  const hasAny = overdueAnnual.length + overduePreUse.length + recent.length > 0

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="inspections" />
          <PageHeader
            title="Equipment inspections"
            description="Pre-use, monthly, and annual inspections — anything overdue, plus recent submissions."
            actions={
              <Link href="/forms?category=inspection">
                <Button variant="outline">Browse inspection templates</Button>
              </Link>
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Badge variant="warning">{overduePreUse.length} pre-use overdue</Badge>
            <Badge variant="destructive">{overdueAnnual.length} annual overdue</Badge>
            <Badge variant="secondary">{recent.length} recent completions</Badge>
          </div>
        </>
      }
    >
      {!hasAny ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="Nothing overdue"
          description="No equipment is currently flagged for an inspection. Recent submissions appear here."
        />
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Pre-use inspections due
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                ({overduePreUse.length})
              </span>
            </div>
            {overduePreUse.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No pre-use checks outstanding.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset tag</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Last pre-use</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overduePreUse.map(({ item, type, site }) => {
                      const href = inspectionLink(item)
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-xs">
                            <Link href={`/equipment/${item.id}`} className="hover:underline">
                              {item.assetTag}
                            </Link>
                          </TableCell>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            {type?.name ?? '—'}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            {site?.name ?? '—'}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            {item.lastPreUseInspectionAt
                              ? new Date(item.lastPreUseInspectionAt).toLocaleString()
                              : 'never'}
                          </TableCell>
                          <TableCell>
                            {href ? (
                              <Link href={href as any}>
                                <Button size="sm" variant="outline">
                                  Start inspection →
                                </Button>
                              </Link>
                            ) : (
                              <Link
                                href={browseLink(item) as any}
                                className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                              >
                                Browse templates →
                              </Link>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-600 dark:text-red-400" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Annual / monthly inspections due
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                ({overdueAnnual.length})
              </span>
            </div>
            {overdueAnnual.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No annual or scheduled inspections outstanding.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset tag</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Last annual</TableHead>
                      <TableHead>Next due</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overdueAnnual.map(({ item, type, site }) => {
                      const href = inspectionLink(item)
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-xs">
                            <Link href={`/equipment/${item.id}`} className="hover:underline">
                              {item.assetTag}
                            </Link>
                          </TableCell>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            {type?.name ?? '—'}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            {site?.name ?? '—'}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            {fmtDate(item.lastAnnualInspectionOn)}
                          </TableCell>
                          <TableCell className="text-red-700 dark:text-red-400">
                            {fmtDate(item.nextAnnualInspectionDue)}
                          </TableCell>
                          <TableCell>
                            {href ? (
                              <Link href={href as any}>
                                <Button size="sm" variant="outline">
                                  Start inspection →
                                </Button>
                              </Link>
                            ) : (
                              <Link
                                href={browseLink(item) as any}
                                className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                              >
                                Browse templates →
                              </Link>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={18} className="text-teal-600" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Recent inspection completions
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">({recent.length})</span>
            </div>
            {recent.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No equipment inspections submitted.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Template</TableHead>
                      <TableHead>Equipment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.map(({ response, template, item }) => (
                      <TableRow key={response.id}>
                        <TableCell className="font-medium">{template.name}</TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {item ? (
                            <Link href={`/equipment/${item.id}`} className="hover:underline">
                              <span className="font-mono text-xs">{item.assetTag}</span> ·{' '}
                              {item.name}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              response.status === 'closed' || response.status === 'submitted'
                                ? 'success'
                                : 'warning'
                            }
                          >
                            {response.status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {response.submittedAt
                            ? new Date(response.submittedAt).toLocaleString()
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/forms/responses/${response.id}`}
                            className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                          >
                            View →
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      )}
    </ListPageLayout>
  )
}
