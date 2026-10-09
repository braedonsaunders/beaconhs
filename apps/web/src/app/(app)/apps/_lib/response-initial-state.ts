import type { FormResponseDraftData } from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/forms-core'

/** Hydrate every full-form editor with both its answers and its save cursor. */
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
      initialDraftRevision: response.draftData.saveRevision ?? 0,
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
    initialDraftRevision: 0,
    isResumed: false,
  }
}
