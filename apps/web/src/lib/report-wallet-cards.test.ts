import { describe, expect, it } from 'vitest'
import {
  reportSupportsWalletCards,
  walletCardLookupsFromResult,
} from './report-wallet-cards-lookups'

describe('report wallet cards', () => {
  it('only offers wallet-card print on training reports', () => {
    expect(reportSupportsWalletCards('training_matrix')).toBe(true)
    expect(reportSupportsWalletCards('training_records')).toBe(true)
    expect(reportSupportsWalletCards('ppe_items')).toBe(false)
  })

  it('collects unique employee and course codes from report rows', () => {
    expect(
      walletCardLookupsFromResult({
        groups: [
          {
            kind: 'results',
            title: 'Results',
            columns: [],
            rows: [
              { employee_no: '1001', course_code: 'FP-01', person_name: 'Ada' },
              { employee_no: '1001', course_code: 'FP-01', person_name: 'Ada' },
              { employee_no: '1002', course_code: 'FP-01' },
              { employee_no: '', course_code: 'FP-01' },
            ],
          },
        ],
        summary: [],
        rowCount: 4,
        truncated: false,
        durationMs: 1,
      }),
    ).toEqual([
      { employeeNo: '1001', courseCode: 'FP-01', personName: 'Ada', courseName: '' },
      { employeeNo: '1002', courseCode: 'FP-01', personName: '', courseName: '' },
    ])
  })
})
