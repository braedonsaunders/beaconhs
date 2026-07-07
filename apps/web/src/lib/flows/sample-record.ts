import 'server-only'

// Find a real record to populate a template PREVIEW with live data (instead of
// [token] placeholders). Picks the most recently created record of the subject;
// the caller then runs the subject's FlowSubjectAdapter.loadValues() on it.

import { desc, eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import {
  correctiveActions,
  documentManagementReviews,
  equipmentItems,
  equipmentWorkOrders,
  formResponses,
  hazidAssessments,
  incidents,
  inspectionRecords,
  journalEntries,
  trainingAssessments,
  truckLogEntries,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

type SampleTable = PgTable & { id: PgColumn; createdAt: PgColumn }

async function latestId(ctx: RequestContext, table: SampleTable): Promise<string | null> {
  const rows = await ctx.db((tx) =>
    tx.select({ id: table.id }).from(table).orderBy(desc(table.createdAt)).limit(1),
  )
  return (rows[0]?.id as string | undefined) ?? null
}

// moduleKey → the table whose latest row is a representative preview record.
const MODULE_SAMPLE_TABLE: Record<string, SampleTable> = {
  journals: journalEntries,
  hazid: hazidAssessments,
  incidents: incidents,
  'corrective-actions': correctiveActions,
  inspections: inspectionRecords,
  training: trainingAssessments,
  equipment: equipmentWorkOrders,
  'equipment-assets': equipmentItems,
  'vehicle-log': truckLogEntries,
  documents: documentManagementReviews,
}

/** The most recent record id for a subject, or null if the tenant has none. */
export async function findSampleSubjectId(
  ctx: RequestContext,
  subjectType: string | null,
  subjectKey: string | null,
): Promise<string | null> {
  if (!subjectType || !subjectKey) return null
  if (subjectType === 'module') {
    const table = MODULE_SAMPLE_TABLE[subjectKey]
    return table ? latestId(ctx, table) : null
  }
  if (subjectType === 'form_template') {
    const rows = await ctx.db((tx) =>
      tx
        .select({ id: formResponses.id })
        .from(formResponses)
        .where(eq(formResponses.templateId, subjectKey))
        .orderBy(desc(formResponses.createdAt))
        .limit(1),
    )
    return rows[0]?.id ?? null
  }
  return null
}
