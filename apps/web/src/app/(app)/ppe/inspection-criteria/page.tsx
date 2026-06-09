// /ppe/inspection-criteria — admin overview spanning all PPE types.
//
// Flat table of every criterion ever defined, grouped by type, with a quick
// link to the source type for inline editing. Useful for an auditor or QA
// reviewer who wants to scan the entire catalog in one place.

import Link from 'next/link'
import { asc, count, eq } from 'drizzle-orm'
import { Camera, ShieldCheck } from 'lucide-react'
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
import { ppeTypeInspectionCriteria, ppeTypes } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { PpeSubNav } from '@/components/ppe-sub-nav'

export const metadata = { title: 'PPE inspection criteria' }
export const dynamic = 'force-dynamic'

export default async function PpeInspectionCriteriaPage() {
  const ctx = await requireModuleManage('ppe')

  const { rows, typeCount, criterionCount, withPhotoCount, highSevCount } =
    await ctx.db(async (tx) => {
      const data = await tx
        .select({
          crit: ppeTypeInspectionCriteria,
          type: ppeTypes,
        })
        .from(ppeTypeInspectionCriteria)
        .innerJoin(ppeTypes, eq(ppeTypes.id, ppeTypeInspectionCriteria.ppeTypeId))
        .orderBy(asc(ppeTypes.name), asc(ppeTypeInspectionCriteria.inspectionKind), asc(ppeTypeInspectionCriteria.entityOrder))
      const [tc] = await tx.select({ c: count() }).from(ppeTypes)
      const [cc] = await tx.select({ c: count() }).from(ppeTypeInspectionCriteria)
      const photoRows = data.filter((r) => r.crit.requiresPhoto)
      const highRows = data.filter(
        (r) => r.crit.severity === 'high' || r.crit.severity === 'critical',
      )
      return {
        rows: data,
        typeCount: Number(tc?.c ?? 0),
        criterionCount: Number(cc?.c ?? 0),
        withPhotoCount: photoRows.length,
        highSevCount: highRows.length,
      }
    })

  const byType = new Map<string, typeof rows>()
  for (const r of rows) {
    const existing = byType.get(r.type.id) ?? []
    existing.push(r)
    byType.set(r.type.id, existing)
  }

  return (
    <ListPageLayout
      header={
        <>
          <PpeSubNav active="inspection-criteria" />
          <PageHeader
            title="PPE inspection criteria"
            description="The full catalog of pass/fail checks across every PPE type. Click a type to manage its criteria."
          />
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{typeCount} types</Badge>
            <Badge variant="secondary">{criterionCount} criteria</Badge>
            <Badge variant={withPhotoCount > 0 ? 'warning' : 'secondary'}>
              {withPhotoCount} require photos
            </Badge>
            <Badge variant={highSevCount > 0 ? 'destructive' : 'secondary'}>
              {highSevCount} high+ severity (auto-CA on fail)
            </Badge>
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={32} />}
          title="No criteria configured yet"
          description="Define a PPE type and add its first pre-use criterion to get started."
          action={
            <Link href="/ppe/types/new">
              <Button>Create a PPE type</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {Array.from(byType.entries()).map(([typeId, typeRows]) => {
            const type = typeRows[0]!.type
            return (
              <Section
                key={typeId}
                title={`${type.name} (${typeRows.length})`}
                subtitle={type.category ? `Category: ${type.category}` : 'No category'}
                actions={
                  <Link
                    href={`/ppe/types/${typeId}?tab=inspection-criteria`}
                    className="text-xs text-teal-700 hover:underline"
                  >
                    Manage in detail page →
                  </Link>
                }
                defaultOpen={false}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>Question</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Photo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {typeRows.map((r, i) => (
                      <TableRow key={r.crit.id}>
                        <TableCell className="text-slate-500">{i + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium text-slate-900">{r.crit.question}</div>
                          {r.crit.description ? (
                            <div className="text-xs text-slate-500">{r.crit.description}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {r.crit.inspectionKind === 'pre_use' ? 'Pre-use' : 'Annual'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.crit.severity === 'critical' || r.crit.severity === 'high'
                                ? 'destructive'
                                : r.crit.severity === 'medium'
                                  ? 'warning'
                                  : 'secondary'
                            }
                          >
                            {r.crit.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {r.crit.requiresPhoto ? <Camera size={14} /> : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            )
          })}
        </div>
      )}
    </ListPageLayout>
  )
}
