import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { activePeopleWhere } from '@beaconhs/db'
import {
  correctiveActions,
  correctiveActionStatus,
  documents,
  documentStatus,
  incidents,
  incidentStatus,
  hazidAssessments,
} from '@beaconhs/db/schema'
import { equipmentRegisterQuery } from './equipment/register-query'

const statuses = {
  incidents: { column: incidents.status, values: incidentStatus.enumValues },
  corrective_actions: {
    column: correctiveActions.status,
    values: correctiveActionStatus.enumValues,
  },
  documents: { column: documents.status, values: documentStatus.enumValues },
} as const
const ACTIVE_DOCUMENT_STATUSES = documentStatus.enumValues.filter((status) => status !== 'archived')
type StatusKind = keyof typeof statuses
type SearchKind = StatusKind | 'people' | 'equipment' | 'hazid_assessments'

/** Exclude inactive directory/assets and archived documents, preserving safety history. */
export function searchableRecordWhere(kind: SearchKind): SQL {
  if (kind === 'people') return activePeopleWhere()
  if (kind === 'equipment') return equipmentRegisterQuery({ status: 'in_service' }).where!
  if (kind === 'documents')
    return and(isNull(documents.deletedAt), inArray(documents.status, ACTIVE_DOCUMENT_STATUSES))!
  if (kind === 'incidents') return isNull(incidents.deletedAt)
  if (kind === 'corrective_actions') return isNull(correctiveActions.deletedAt)
  return isNull(hazidAssessments.deletedAt)
}

/** Validate status values before passing them to PostgreSQL enum columns. */
export function recordStatusWhere(kind: StatusKind, value: string | undefined): SQL | undefined {
  if (!value || value === 'all') return undefined
  if (value === 'active' && kind === 'documents') return searchableRecordWhere(kind)
  const entity = statuses[kind]
  const status = entity.values.find((candidate) => candidate === value)
  return status ? eq(entity.column, status) : sql`false`
}

export function activeDocumentStatusCount(counts: Record<string, number>): number {
  return ACTIVE_DOCUMENT_STATUSES.reduce((total, status) => total + (counts[status] ?? 0), 0)
}
