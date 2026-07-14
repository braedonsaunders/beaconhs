import 'server-only'

// Find a real record to populate a template PREVIEW with live data (instead of
// [token] placeholders). Picks the most recently created record of the subject;
// the caller then runs the subject's FlowSubjectAdapter.loadValues() on it.

import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import {
  correctiveActions,
  documentManagementReviews,
  equipmentInspectionRecords,
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

type SampleTable = PgTable & { id: PgColumn; tenantId: PgColumn; createdAt: PgColumn }
type SampleSource = { table: SampleTable; liveWhere?: SQL }

async function latestId(ctx: RequestContext, source: SampleSource): Promise<string | null> {
  const rows = await ctx.db((tx) =>
    tx
      .select({ id: source.table.id })
      .from(source.table)
      .where(and(eq(source.table.tenantId, ctx.tenantId), source.liveWhere))
      .orderBy(desc(source.table.createdAt))
      .limit(1),
  )
  return (rows[0]?.id as string | undefined) ?? null
}

// moduleKey → the table whose latest row is a representative preview record.
const MODULE_SAMPLE_TABLE: Record<string, SampleSource> = {
  journals: { table: journalEntries, liveWhere: isNull(journalEntries.deletedAt) },
  hazid: { table: hazidAssessments, liveWhere: isNull(hazidAssessments.deletedAt) },
  incidents: { table: incidents, liveWhere: isNull(incidents.deletedAt) },
  'corrective-actions': {
    table: correctiveActions,
    liveWhere: isNull(correctiveActions.deletedAt),
  },
  inspections: {
    table: inspectionRecords,
    liveWhere: isNull(inspectionRecords.deletedAt),
  },
  training: { table: trainingAssessments, liveWhere: isNull(trainingAssessments.deletedAt) },
  equipment: { table: equipmentWorkOrders },
  'equipment-assets': {
    table: equipmentItems,
    liveWhere: isNull(equipmentItems.deletedAt),
  },
  'equipment-inspections': {
    table: equipmentInspectionRecords,
    liveWhere: isNull(equipmentInspectionRecords.deletedAt),
  },
  'vehicle-log': { table: truckLogEntries },
  documents: {
    table: documentManagementReviews,
    liveWhere: isNull(documentManagementReviews.deletedAt),
  },
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
        .where(
          and(
            eq(formResponses.tenantId, ctx.tenantId),
            eq(formResponses.templateId, subjectKey),
            isNull(formResponses.deletedAt),
          ),
        )
        .orderBy(desc(formResponses.createdAt))
        .limit(1),
    )
    return rows[0]?.id ?? null
  }
  return null
}
