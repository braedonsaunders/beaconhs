import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ guard: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/module-admin/guard', () => ({ requireModuleManage: mocks.guard }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
import { addSkillTypeFile, removeSkillTypeFile } from './_files-actions'

const typeId = '00000000-0000-4000-8000-000000000001'
const attachmentId = '00000000-0000-4000-8000-000000000002'
const fileId = '00000000-0000-4000-8000-000000000003'
const input = { recordId: typeId, attachmentId, label: 'Instructions', kind: 'evidence' }
let limit: ReturnType<typeof vi.fn>
let values: ReturnType<typeof vi.fn>
let returning: ReturnType<typeof vi.fn>
let tx: {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}
let ctx: { tenantId: string; userId: string; db: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.resetAllMocks()
  limit = vi
    .fn()
    .mockResolvedValueOnce([{ id: typeId }])
    .mockResolvedValue([{ id: attachmentId }])
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    limit,
  }
  returning = vi.fn().mockResolvedValue([{ id: fileId, label: input.label }])
  values = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockReturnValue({ returning }) })
  tx = {
    select: vi.fn().mockReturnValue(query),
    insert: vi.fn().mockReturnValue({ values }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning }) }),
  }
  ctx = { tenantId: typeId, userId: 'uploader', db: vi.fn(async (run) => run(tx)) }
  mocks.guard.mockResolvedValue(ctx)
})

describe('skill type file mutations', () => {
  it('requires training management and validates before database access', async () => {
    expect((await addSkillTypeFile({ ...input, recordId: 'invalid' })).ok).toBe(false)
    expect((await addSkillTypeFile({ ...input, kind: 'executable' })).ok).toBe(false)
    expect((await addSkillTypeFile({ ...input, label: '' })).ok).toBe(false)
    expect(ctx.db).not.toHaveBeenCalled()
    expect(mocks.guard).toHaveBeenCalledWith('training')
    mocks.guard.mockRejectedValue(new Error('Forbidden'))
    await expect(addSkillTypeFile(input)).rejects.toThrow('Forbidden')
  })

  it('rejects unavailable records and uploads without inserting evidence', async () => {
    limit.mockReset().mockResolvedValueOnce([])
    expect(await addSkillTypeFile(input)).toEqual({ ok: false, error: 'Skill type not found.' })
    limit.mockResolvedValueOnce([{ id: typeId }]).mockResolvedValueOnce([])
    expect(await addSkillTypeFile(input)).toEqual({
      ok: false,
      error: 'Upload a file before attaching it.',
    })
    expect(tx.insert).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('stores and audits the link in the tenant transaction', async () => {
    expect(await addSkillTypeFile(input)).toEqual({ ok: true })
    expect(values).toHaveBeenCalledWith({
      tenantId: ctx.tenantId,
      skillTypeId: typeId,
      attachmentId,
      label: input.label,
      kind: input.kind,
      uploadedBy: ctx.userId,
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({
        entityId: typeId,
        metadata: { fileId, attachmentId, kind: input.kind },
      }),
    )
    expect(mocks.revalidate).toHaveBeenCalledWith(`/training/skills/types/${typeId}`)
  })

  it('does not report success or audit a duplicate file', async () => {
    returning.mockResolvedValue([])
    expect(await addSkillTypeFile(input)).toEqual({
      ok: false,
      error: 'This file is already attached.',
    })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('removes only the link and audits it; missing links fail', async () => {
    const form = new FormData()
    form.set('skillTypeId', typeId)
    form.set('fileId', fileId)
    await removeSkillTypeFile(form)
    expect(tx.delete).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({ action: 'delete', entityId: typeId }),
    )
    returning.mockResolvedValue([])
    await expect(removeSkillTypeFile(form)).rejects.toThrow('File not found.')
  })
})
