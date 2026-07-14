import { describe, expect, it } from 'vitest'
import { parseIncidentInjuryInput } from './incident-injury-input'

const INCIDENT_ID = '10000000-0000-4000-8000-000000000001'
const PERSON_ID = '20000000-0000-4000-8000-000000000002'
const TYPE_ID = '30000000-0000-4000-8000-000000000003'

function validInput() {
  return {
    incidentId: INCIDENT_ID,
    personId: PERSON_ID,
    personName: 'Ignored when a directory person is selected',
    injuryTypeIds: [TYPE_ID],
    injuryResult: '  X-rays clear; modified duties assigned.  ',
    bodyParts: [' Left wrist '],
    treatment: '  Ice and compression  ',
    treatedAtFacility: '  Site clinic  ',
    workedHoursPriorTo: 6,
  }
}

describe('incident injury input', () => {
  it('keeps canonical type IDs separate from normalized outcome text', () => {
    expect(parseIncidentInjuryInput(validInput())).toEqual({
      id: null,
      incidentId: INCIDENT_ID,
      personId: PERSON_ID,
      personName: null,
      injuryTypeIds: [TYPE_ID],
      injuryResult: 'X-rays clear; modified duties assigned.',
      bodyParts: ['Left wrist'],
      treatment: 'Ice and compression',
      treatedAtFacility: 'Site clinic',
      workedHoursPriorTo: 6,
    })
  })

  it('accepts an external injured-person name and an empty taxonomy assignment', () => {
    expect(
      parseIncidentInjuryInput({
        ...validInput(),
        personId: null,
        personName: '  External worker  ',
        injuryTypeIds: [],
      }),
    ).toMatchObject({ personId: null, personName: 'External worker', injuryTypeIds: [] })
  })

  it('rejects malformed, duplicate, or unbounded values at the action boundary', () => {
    expect(() =>
      parseIncidentInjuryInput({ ...validInput(), personId: null, personName: ' ' }),
    ).toThrow(/Pick the injured person/)
    expect(() =>
      parseIncidentInjuryInput({ ...validInput(), injuryTypeIds: [TYPE_ID, TYPE_ID] }),
    ).toThrow(/duplicate/)
    expect(() =>
      parseIncidentInjuryInput({ ...validInput(), bodyParts: ['Left hand', 'left hand'] }),
    ).toThrow(/duplicate/)
    expect(() => parseIncidentInjuryInput({ ...validInput(), workedHoursPriorTo: 6.5 })).toThrow(
      /whole number/,
    )
    expect(() =>
      parseIncidentInjuryInput({ ...validInput(), injuryResult: 'x'.repeat(1_001) }),
    ).toThrow(/too long/)
  })
})
