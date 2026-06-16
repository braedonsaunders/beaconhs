// /ppe/types — admin CRUD list of PPE types.
//
// Each row shows the type name, category, the count of items in the register,
// and quick links to the type detail (sub-tabs: general / criteria / sizing)
// or to delete it. New types go through /ppe/types/new which renders the same
// form pattern as the rest of the platform (a wizard-like single-screen
// form with a sub-nav).

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Pencil, ShieldCheck, Trash2 } from 'lucide-react'
import { asc, count, eq } from 'drizzle-orm'
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
import { ppeItems, ppeTypeInspectionCriteria, ppeTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule, requireModuleManage } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { PpeSubNav } from '@/components/ppe-sub-nav'

export const metadata = { title: 'PPE types' }
export const dynamic = 'force-dynamic'

async function deleteType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  await ctx.db((tx) => tx.delete(ppeTypes).where(eq(ppeTypes.id, id)))
  await recordAudit(ctx, {
    entityType: 'ppe_type',
    entityId: id,
    action: 'delete',
    summary: 'Deleted PPE type',
  })
  revalidatePath('/ppe/types')
}

export default async function PpeTypesPage() {
  const ctx = await requireModuleManage('ppe')
  const { types, itemCounts, criteriaCounts } = await ctx.db(async (tx) => {
    const t = await tx.select().from(ppeTypes).orderBy(asc(ppeTypes.name))
    const itemTally = await tx
      .select({ typeId: ppeItems.typeId, c: count() })
      .from(ppeItems)
      .groupBy(ppeItems.typeId)
    const critTally = await tx
      .select({ ppeTypeId: ppeTypeInspectionCriteria.ppeTypeId, c: count() })
      .from(ppeTypeInspectionCriteria)
      .groupBy(ppeTypeInspectionCriteria.ppeTypeId)
    return {
      types: t,
      itemCounts: Object.fromEntries(itemTally.map((x) => [x.typeId, Number(x.c)])),
      criteriaCounts: Object.fromEntries(critTally.map((x) => [x.ppeTypeId, Number(x.c)])),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PpeSubNav active="types" />
          <PageHeader
            title="PPE types"
            description="PPE catalog with criteria, sizing, and cadence per type."
            actions={
              <Link href="/ppe/types/new">
                <Button>New PPE type</Button>
              </Link>
            }
          />
        </>
      }
    >
      {types.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={32} />}
          title="No PPE types"
          description="Add types like Hard hat, Harness, Safety glasses, Gloves — every PPE item must belong to a type."
          action={
            <Link href="/ppe/types/new">
              <Button>New PPE type</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Inspectable</TableHead>
                <TableHead className="text-right">Criteria</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => {
                const n = itemCounts[t.id] ?? 0
                const critN = criteriaCounts[t.id] ?? 0
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        href={`/ppe/types/${t.id}`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {t.category ?? '—'}
                    </TableCell>
                    <TableCell>
                      {t.isInspectable ? (
                        <Badge variant="success">Yes</Badge>
                      ) : (
                        <Badge variant="secondary">No</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={critN > 0 ? 'secondary' : 'warning'}>{critN}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{n}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Link href={`/ppe/types/${t.id}`}>
                          <Button size="sm" variant="outline">
                            <Pencil size={12} /> Edit
                          </Button>
                        </Link>
                        <form action={deleteType}>
                          <input type="hidden" name="id" value={t.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            disabled={n > 0}
                            title={
                              n > 0
                                ? `Cannot delete — ${n} item(s) reference this type`
                                : 'Delete type'
                            }
                          >
                            <Trash2 size={12} />
                          </Button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </ListPageLayout>
  )
}
