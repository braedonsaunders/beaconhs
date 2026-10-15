import { describe, expect, it } from 'vitest'
import { SYNC_MAX_PATCHES } from '@/lib/offline-drafts/protocol'
import { parseRecordSyncRequest } from './request'

const RECORD_ID = '5b0f3c3e-2f7a-4d6e-9a51-0c6f4c1b2d3e'

describe('record sync request validation', () => {
  it('accepts a batch for a registered module and normalises missing values to null', () => {
    expect(
      parseRecordSyncRequest({
        scope: 't1:u1',
        module: 'incidents',
        recordId: RECORD_ID,
        patches: [{ fieldId: 'title', value: 'Ladder slip' }],
      }),
    ).toEqual({
      scope: 't1:u1',
      module: 'incidents',
      recordId: RECORD_ID,
      patches: [{ fieldId: 'title', value: 'Ladder slip', base: null }],
    })
  })

  it('refuses unknown modules, non-uuid records, and malformed patches', () => {
    const patches = [{ fieldId: 'title', value: 'x', base: '' }]
    expect(parseRecordSyncRequest({ module: 'incidents', recordId: RECORD_ID, patches })).toBeNull()
    expect(
      parseRecordSyncRequest({ scope: 't1:u1', module: 'payroll', recordId: RECORD_ID, patches }),
    ).toBeNull()
    expect(parseRecordSyncRequest({ module: 'incidents', recordId: '42', patches })).toBeNull()
    expect(
      parseRecordSyncRequest({ module: 'incidents', recordId: RECORD_ID, patches: [] }),
    ).toBeNull()
    expect(
      parseRecordSyncRequest({
        module: 'incidents',
        recordId: RECORD_ID,
        patches: [{ fieldId: '', value: 'x' }],
      }),
    ).toBeNull()
    expect(parseRecordSyncRequest(null)).toBeNull()
    expect(parseRecordSyncRequest('incidents')).toBeNull()
  })

  it('refuses a batch that names a field twice or exceeds the request cap', () => {
    expect(
      parseRecordSyncRequest({
        module: 'incidents',
        recordId: RECORD_ID,
        patches: [
          { fieldId: 'title', value: 'a', base: '' },
          { fieldId: 'title', value: 'b', base: '' },
        ],
      }),
    ).toBeNull()
    expect(
      parseRecordSyncRequest({
        module: 'incidents',
        recordId: RECORD_ID,
        patches: Array.from({ length: SYNC_MAX_PATCHES + 1 }, (_, index) => ({
          fieldId: `f${index}`,
          value: index,
          base: null,
        })),
      }),
    ).toBeNull()
  })
})
