import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { ppeItems, ppeTypes, ppeTypeInspectionCriteria } from '@beaconhs/db/schema'
import { resolvePpeInspectionDue } from '@/lib/ppe-inspection-due'

/** Inspectable assigned gear with annual warnings independent of its pre-use checklist. */
export async function loadPersonalPpe(
  tx: Database,
  myPersonId: string | null,
  todayIso: string,
  canInspect: boolean,
) {
  return myPersonId
    ? (
        await tx
          .select({
            id: ppeItems.id,
            serialNumber: ppeItems.serialNumber,
            size: ppeItems.size,
            status: ppeItems.status,
            lastAnnualInspectionOn: ppeItems.lastAnnualInspectionOn,
            nextAnnualInspectionDue: ppeItems.nextAnnualInspectionDue,
            typeName: ppeTypes.name,
            isInspectable: ppeTypes.isInspectable,
            preUseCriteriaCount: sql<number>`(
                select count(*)::int from ${ppeTypeInspectionCriteria} c
                where c.ppe_type_id = ${ppeTypes.id} and c.inspection_kind = 'pre_use'
              )`,
            annualCriteriaCount: sql<number>`(
                select count(*)::int from ${ppeTypeInspectionCriteria} c
                where c.ppe_type_id = ${ppeTypes.id} and c.inspection_kind = 'annual'
              )`,
          })
          .from(ppeItems)
          .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
          .where(
            and(
              eq(ppeItems.currentHolderPersonId, myPersonId),
              inArray(ppeItems.status, ['issued', 'out_of_service']),
              isNull(ppeItems.deletedAt),
            ),
          )
          .orderBy(asc(ppeTypes.name), asc(ppeItems.serialNumber))
      )
        .filter(
          (r) =>
            r.isInspectable &&
            (Number(r.preUseCriteriaCount) > 0 || Number(r.annualCriteriaCount) > 0),
        )
        .map((r) => ({
          row: r,
          due: resolvePpeInspectionDue({
            todayIso,
            isInspectable: r.isInspectable,
            preUseCriteriaCount: 0,
            annualCriteriaCount: Number(r.annualCriteriaCount),
            lastInspectionOn: null,
            nextInspectionDue: null,
            lastAnnualInspectionOn: r.lastAnnualInspectionOn
              ? String(r.lastAnnualInspectionOn)
              : null,
            nextAnnualInspectionDue: r.nextAnnualInspectionDue
              ? String(r.nextAnnualInspectionDue)
              : null,
          }),
        }))
        .sort((a, b) => {
          const rank = { overdue: 0, never_inspected: 1, required: 2, due_today: 3 } as const
          const aRank = rank[a.due.state as keyof typeof rank] ?? 4
          const bRank = rank[b.due.state as keyof typeof rank] ?? 4
          return aRank - bRank || (a.due.dueOn ?? '').localeCompare(b.due.dueOn ?? '')
        })
        .slice(0, 12)
        .map(({ row, due }) => ({
          id: row.id,
          typeName: row.typeName,
          serialNumber: row.serialNumber,
          size: row.size,
          status:
            row.status === 'out_of_service' ? ('out_of_service' as const) : ('issued' as const),
          canRecordPreUse:
            canInspect && Number(row.preUseCriteriaCount) > 0 && row.status !== 'out_of_service',
          annualInspectionState: due.state,
          annualInspectionDueOn: due.dueOn,
        }))
    : []
}
