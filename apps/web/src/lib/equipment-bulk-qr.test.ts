import { describe, expect, it } from 'vitest'
import { parseBulkQrRequest } from './equipment-bulk-qr'

const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'

describe('bulk equipment QR request policy', () => {
  it('requires the stamped 64-bit base64url token and valid UUID ids', () => {
    expect(
      parseBulkQrRequest(`https://app.test/equipment/qr/labels?ids=${A}&token=abcdefghijk`),
    ).toEqual({ ids: [A], token: 'abcdefghijk' })
    expect(parseBulkQrRequest(`https://app.test/equipment/qr/labels?ids=${A}`)).toBeNull()
    expect(
      parseBulkQrRequest('https://app.test/equipment/qr/labels?ids=not-a-uuid&token=abcdefghijk'),
    ).toBeNull()
  })

  it('deduplicates ids and rejects requests over the generation cap', () => {
    expect(
      parseBulkQrRequest(
        `https://app.test/equipment/qr/labels?ids=${A},${A},${B}&token=abcdefghijk`,
      ),
    ).toEqual({ ids: [A, B], token: 'abcdefghijk' })
    const tooMany = Array.from({ length: 501 }, () => A).join(',')
    expect(
      parseBulkQrRequest(`https://app.test/equipment/qr/labels?ids=${tooMany}&token=abcdefghijk`),
    ).toBeNull()
  })
})
