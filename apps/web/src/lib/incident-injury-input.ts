import {
  optionalNumberInput,
  optionalTextInput,
  optionalUuidInput,
  requireRecordInput,
  requireUuidArrayInput,
  requireUuidInput,
} from './mutation-input'

const MAX_INJURY_TYPES = 20
const MAX_BODY_PARTS = 20

function boundedTextArray(
  value: unknown,
  label: string,
  options: { maxEntries: number; maxEntryLength: number },
): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid.`)
  if (value.length > options.maxEntries) throw new Error(`${label} has too many entries.`)

  const normalized = value.map((entry) => {
    if (typeof entry !== 'string') throw new Error(`${label} is invalid.`)
    const text = entry.trim()
    if (!text) throw new Error(`${label} contains an empty entry.`)
    if (text.length > options.maxEntryLength)
      throw new Error(`${label} contains an entry that is too long.`)
    return text
  })
  const keys = normalized.map((entry) => entry.toLocaleLowerCase())
  if (new Set(keys).size !== keys.length) throw new Error(`${label} contains duplicate entries.`)
  return normalized
}

type ParsedIncidentInjuryInput = {
  id: string | null
  incidentId: string
  personId: string | null
  personName: string | null
  injuryTypeIds: string[]
  injuryResult: string | null
  bodyParts: string[]
  treatment: string | null
  treatedAtFacility: string | null
  workedHoursPriorTo: number | null
}

/**
 * Normalize the server-action boundary without trusting the client-side type.
 * Taxonomy IDs remain IDs; descriptive result/outcome text is never folded
 * into the managed injury-type collection.
 */
export function parseIncidentInjuryInput(value: unknown): ParsedIncidentInjuryInput {
  const input = requireRecordInput(value, 'Injury')
  const id = optionalUuidInput(input.id, 'Injury')
  const incidentId = requireUuidInput(input.incidentId, 'Incident')
  const personId = optionalUuidInput(input.personId, 'Injured person')
  const typedPersonName = optionalTextInput(input.personName, 'Injured person name', 200)
  if (!personId && !typedPersonName) {
    throw new Error('Pick the injured person or type a name.')
  }

  return {
    id,
    incidentId,
    personId,
    personName: personId ? null : typedPersonName,
    injuryTypeIds: requireUuidArrayInput(input.injuryTypeIds, 'Injury types', {
      min: 0,
      max: MAX_INJURY_TYPES,
    }),
    injuryResult: optionalTextInput(input.injuryResult, 'Injury result / outcome', 1_000),
    bodyParts: boundedTextArray(input.bodyParts, 'Body parts', {
      maxEntries: MAX_BODY_PARTS,
      maxEntryLength: 100,
    }),
    treatment: optionalTextInput(input.treatment, 'Treatment details', 4_000),
    treatedAtFacility: optionalTextInput(input.treatedAtFacility, 'Treatment facility', 300),
    workedHoursPriorTo: optionalNumberInput(input.workedHoursPriorTo, 'Hours worked prior', {
      min: 0,
      max: 24,
      integer: true,
    }),
  }
}
