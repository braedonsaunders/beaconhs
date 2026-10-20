import { normalizeFormResponseData, type FormSchemaV1 } from '@beaconhs/forms-core'

/** Copy content, never old ink or live confined-space measurements. */
export function copyHazidAppPayload(
  schema: FormSchemaV1,
  payload: Record<string, unknown>,
  options: { templateKey: string; date: string; includePhotos: boolean },
): Record<string, unknown> {
  const copy = structuredClone(normalizeFormResponseData(schema, payload))
  for (const section of schema.sections) {
    if (
      options.templateKey === 'hazid-confined-space-entry-plan' &&
      ['atmospheric_readings', 'entry_log'].includes(section.id)
    ) {
      copy[section.id] = []
      continue
    }
    const targets = section.repeating
      ? Array.isArray(copy[section.id])
        ? (copy[section.id] as Record<string, unknown>[])
        : []
      : [copy]
    for (const target of targets) {
      for (const field of section.fields) {
        if (field.type === 'signature' || (field.type === 'photo' && !options.includePhotos)) {
          delete target[field.id]
        } else if (field.type === 'date' && field.defaultValue?.kind === 'today') {
          target[field.id] = options.date
        }
      }
    }
  }
  if (options.templateKey === 'hazid-confined-space-entry-plan') delete copy.all_entrants_out
  return copy
}
