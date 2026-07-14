import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  inspectionBankCriteria,
  inspectionBankResponseType,
  inspectionRecordCriteria,
  inspectionTypeCriteria,
} from './schema'

describe('inspection configured response integrity', () => {
  it('keeps every response kind in the one canonical inspection response enum', () => {
    expect(inspectionBankResponseType.enumValues).toEqual([
      'pass_fail_na',
      'rating',
      'yes_no',
      'choice',
      'text',
      'long_text',
      'number',
    ])
  })

  it('stores validated options on banks and types, then snapshots them on records', () => {
    const bank = getTableConfig(inspectionBankCriteria)
    const type = getTableConfig(inspectionTypeCriteria)
    const record = getTableConfig(inspectionRecordCriteria)

    expect(bank.columns.map((column) => column.name)).toContain('choice_options')
    expect(type.columns.map((column) => column.name)).toContain('choice_options')
    expect(record.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'choice_options_snapshot',
        'choice_answer',
        'text_answer',
        'number_answer',
      ]),
    )
    expect(bank.checks.map((check) => check.name)).toContain(
      'inspection_bank_criteria_choice_options_ck',
    )
    expect(type.checks.map((check) => check.name)).toContain(
      'inspection_type_criteria_choice_options_ck',
    )
    expect(record.checks.map((check) => check.name)).toContain(
      'inspection_record_criteria_response_shape_ck',
    )
  })
})
