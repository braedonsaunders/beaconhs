import type { FormResponseDraftData } from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/forms-core'

/**
 * Hydrate every full-form editor with both its answers and its save cursor.
 * The cursor is the server's draft ordering state; the filler compares it with
 * any unsynced copy on the device to decide whether that copy is newer.
 */
export function responseInitialState(
  schema: FormSchemaV1,
  response: {
    status: string
    draftData: FormResponseDraftData | null
    data: Record<string, unknown> | null
    draftStepIndex: number | null
  } | null,
) {
  const isDraft = response?.status === 'draft' || response?.status === 'in_progress'
  if (isDraft && response?.draftData)
    return {
      initialValues: response.draftData.values ?? {},
      initialRows: response.draftData.rows ?? {},
      initialStepIndex: response.draftStepIndex ?? 0,
      initialDraftCursor: {
        revision: response.draftData.saveRevision ?? 0,
        sessionId: response.draftData.saveSessionId ?? null,
        sequence: response.draftData.saveSequence ?? 0,
      },
      isResumed: true,
    }
  const initialValues = response?.data ?? {}
  const initialRows: Record<string, Array<Record<string, unknown>>> = {}
  for (const section of schema.sections) {
    const rows = initialValues[section.id]
    if (section.repeating && Array.isArray(rows))
      initialRows[section.id] = rows as Array<Record<string, unknown>>
  }
  return {
    initialValues,
    initialRows,
    initialStepIndex: 0,
    initialDraftCursor: { revision: 0, sessionId: null, sequence: 0 },
    isResumed: false,
  }
}
