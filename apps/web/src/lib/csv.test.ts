import { describe, expect, it } from 'vitest'
import {
  CSV_EXPORT_MAX_ROWS,
  CSV_EXPORT_QUERY_LIMIT,
  csvExportOverflowResponse,
  csvRow,
} from './csv'

describe('CSV export safety', () => {
  it('uses one sentinel row to distinguish a complete export from truncation', async () => {
    expect(CSV_EXPORT_QUERY_LIMIT).toBe(CSV_EXPORT_MAX_ROWS + 1)
    expect(csvExportOverflowResponse(CSV_EXPORT_MAX_ROWS)).toBeNull()

    const response = csvExportOverflowResponse(CSV_EXPORT_QUERY_LIMIT)
    expect(response?.status).toBe(422)
    expect(response?.headers.get('cache-control')).toBe('private, no-store')
    expect(response?.headers.get('x-beaconhs-export-row-limit')).toBe('10000')
    await expect(response?.json()).resolves.toEqual({
      error:
        'This export has more than 10,000 matching rows. Narrow the search or filters and try again.',
    })
  })

  it('neutralizes spreadsheet formulas while preserving numeric values', () => {
    expect(csvRow(['=cmd()', '+SUM(A1)', '-2', '@link', -2, 'safe'])).toBe(
      "'=cmd(),'+SUM(A1),'-2,'@link,-2,safe",
    )
  })
})
