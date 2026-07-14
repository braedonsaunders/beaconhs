import { describe, expect, it } from 'vitest'
import {
  parseDeleteExtraFieldInput,
  parseExtraFieldInput,
  TRAINING_EXTRA_FIELD_KEY_MAX,
  TRAINING_EXTRA_FIELD_VALUE_MAX,
} from './extra-field-policy'

const OWNER_ID = '10000000-0000-4000-8000-000000000001'
const FIELD_ID = '20000000-0000-4000-8000-000000000001'

describe('training additional-field mutation policy', () => {
  it('normalizes a valid field without altering its content', () => {
    expect(
      parseExtraFieldInput({
        ownerType: 'skill',
        ownerId: OWNER_ID,
        fieldKey: '  Union local  ',
        fieldValue: '  128  ',
      }),
    ).toEqual({
      ownerType: 'skill',
      ownerId: OWNER_ID,
      fieldKey: 'Union local',
      fieldValue: '128',
    })
  })

  it('rejects overlong fields instead of silently truncating them', () => {
    expect(() =>
      parseExtraFieldInput({
        ownerType: 'authority',
        ownerId: OWNER_ID,
        fieldKey: 'x'.repeat(TRAINING_EXTRA_FIELD_KEY_MAX + 1),
        fieldValue: null,
      }),
    ).toThrow('Field name is too long.')
    expect(() =>
      parseExtraFieldInput({
        ownerType: 'skill_type',
        ownerId: OWNER_ID,
        fieldKey: 'Reference',
        fieldValue: 'x'.repeat(TRAINING_EXTRA_FIELD_VALUE_MAX + 1),
      }),
    ).toThrow('Field value is too long.')
  })

  it('rejects malformed owner and value types', () => {
    expect(() =>
      parseExtraFieldInput({
        ownerType: 'course',
        ownerId: OWNER_ID,
        fieldKey: 'Reference',
        fieldValue: null,
      }),
    ).toThrow('Owner type is invalid.')
    expect(() =>
      parseExtraFieldInput({
        ownerType: 'skill',
        ownerId: OWNER_ID,
        fieldKey: 'Reference',
        fieldValue: { unexpected: true },
      }),
    ).toThrow('Field value is invalid.')
  })

  it('strictly validates delete identifiers', () => {
    expect(
      parseDeleteExtraFieldInput({ id: FIELD_ID, ownerType: 'authority', ownerId: OWNER_ID }),
    ).toEqual({ id: FIELD_ID, ownerType: 'authority', ownerId: OWNER_ID })
    expect(() =>
      parseDeleteExtraFieldInput({ id: 'bad', ownerType: 'authority', ownerId: OWNER_ID }),
    ).toThrow('Additional field is invalid.')
  })
})
