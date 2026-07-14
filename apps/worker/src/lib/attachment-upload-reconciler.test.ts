import { describe, expect, it } from 'vitest'
import {
  applyExpiredUploadReconciliation,
  expiredUploadReconciliationDecision,
} from './attachment-upload-reconciler'

const reservation = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  attachmentId: null,
  kind: 'document' as const,
  r2Key: 't/10000000-0000-4000-8000-000000000001/document/report.pdf',
  contentType: 'application/pdf; charset=binary',
  sizeBytes: 42,
  filename: 'report.pdf',
}

const liveAttachment = {
  id: '20000000-0000-4000-8000-000000000001',
  tenantId: reservation.tenantId,
  kind: reservation.kind,
  r2Key: reservation.r2Key,
  contentType: 'APPLICATION/PDF',
  sizeBytes: reservation.sizeBytes,
  filename: reservation.filename,
}

describe('expired attachment upload reconciliation', () => {
  it('discards only when no attachment metadata owns the final object key', () => {
    expect(expiredUploadReconciliationDecision(reservation, null)).toEqual({ kind: 'discard' })
  })

  it('recovers the exact same-tenant attachment with normalized content type', () => {
    expect(expiredUploadReconciliationDecision(reservation, liveAttachment)).toEqual({
      kind: 'recover',
      attachmentId: liveAttachment.id,
    })
  })

  it('fails closed for cross-tenant, conflicting-link, and metadata mismatches', () => {
    expect(() =>
      expiredUploadReconciliationDecision(reservation, {
        ...liveAttachment,
        tenantId: '10000000-0000-4000-8000-000000000002',
      }),
    ).toThrow(/tenant and key/)
    expect(() =>
      expiredUploadReconciliationDecision(
        { ...reservation, attachmentId: '20000000-0000-4000-8000-000000000002' },
        liveAttachment,
      ),
    ).toThrow(/different live attachment/)
    expect(() =>
      expiredUploadReconciliationDecision(reservation, {
        ...liveAttachment,
        sizeBytes: reservation.sizeBytes + 1,
      }),
    ).toThrow(/metadata/)
  })

  it('deletes only staging before recovering a live attachment link', async () => {
    const events: string[] = []
    const kind = await applyExpiredUploadReconciliation(
      { stagingKey: `${reservation.r2Key}.staging`, r2Key: reservation.r2Key },
      { kind: 'recover', attachmentId: liveAttachment.id },
      {
        deleteObject: async (key) => void events.push(`delete:${key}`),
        recover: async (id) => void events.push(`recover:${id}`),
        discard: async () => void events.push('discard'),
      },
    )

    expect(kind).toBe('recover')
    expect(events).toEqual([`delete:${reservation.r2Key}.staging`, `recover:${liveAttachment.id}`])
  })

  it('deletes staging and final before discarding the database row', async () => {
    const events: string[] = []
    const kind = await applyExpiredUploadReconciliation(
      { stagingKey: `${reservation.r2Key}.staging`, r2Key: reservation.r2Key },
      { kind: 'discard' },
      {
        deleteObject: async (key) => void events.push(`delete:${key}`),
        recover: async (id) => void events.push(`recover:${id}`),
        discard: async () => void events.push('discard'),
      },
    )

    expect(kind).toBe('discard')
    expect(events).toEqual([
      `delete:${reservation.r2Key}.staging`,
      `delete:${reservation.r2Key}`,
      'discard',
    ])
  })

  it('retains the database row when an object deletion fails', async () => {
    const events: string[] = []
    await expect(
      applyExpiredUploadReconciliation(
        { stagingKey: `${reservation.r2Key}.staging`, r2Key: reservation.r2Key },
        { kind: 'discard' },
        {
          deleteObject: async (key) => {
            events.push(`delete:${key}`)
            if (key === reservation.r2Key) throw new Error('storage unavailable')
          },
          recover: async () => undefined,
          discard: async () => void events.push('discard'),
        },
      ),
    ).rejects.toThrow('storage unavailable')
    expect(events).toEqual([`delete:${reservation.r2Key}.staging`, `delete:${reservation.r2Key}`])
  })
})
