import type { Database } from '@beaconhs/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { materializeEvidence } = vi.hoisted(() => ({
  materializeEvidence: vi.fn(),
}))

vi.mock('@beaconhs/compliance', () => ({
  materializeEvidenceTargetObligations: materializeEvidence,
}))

import {
  formResponseEvidenceChanged,
  isActiveFormResponseEvidence,
  materializeFormResponseEvidenceChange,
  type FormResponseEvidenceSnapshot,
} from './form-response-evidence'

const submitted: FormResponseEvidenceSnapshot = {
  templateId: 'template-1',
  complianceObligationId: 'obligation-1',
  status: 'submitted',
  submittedAt: new Date('2026-07-14T12:00:00.000Z'),
  submittedBy: 'membership-1',
  deletedAt: null,
}

describe('form response compliance evidence projection', () => {
  beforeEach(() => {
    materializeEvidence.mockReset()
  })

  it('requires the exact fields used by the form evaluator', () => {
    expect(isActiveFormResponseEvidence(submitted)).toBe(true)
    for (const value of [
      { ...submitted, complianceObligationId: null },
      { ...submitted, status: 'in_progress' },
      { ...submitted, submittedAt: null },
      { ...submitted, submittedBy: null },
      { ...submitted, deletedAt: new Date() },
    ]) {
      expect(isActiveFormResponseEvidence(value)).toBe(false)
    }
  })

  it('ignores draft-only and eligible-to-eligible status changes', () => {
    const draft = { ...submitted, status: 'draft', submittedAt: null }
    expect(formResponseEvidenceChanged(draft, { ...draft, status: 'in_progress' })).toBe(false)
    expect(formResponseEvidenceChanged(submitted, { ...submitted, status: 'closed' })).toBe(false)
  })

  it('detects evidence creation, removal, reassignment, and retargeting', () => {
    expect(formResponseEvidenceChanged(null, submitted)).toBe(true)
    expect(formResponseEvidenceChanged(submitted, { ...submitted, status: 'in_progress' })).toBe(
      true,
    )
    expect(formResponseEvidenceChanged(submitted, { ...submitted, deletedAt: new Date() })).toBe(
      true,
    )
    expect(
      formResponseEvidenceChanged(submitted, { ...submitted, submittedBy: 'membership-2' }),
    ).toBe(true)
    expect(formResponseEvidenceChanged(submitted, { ...submitted, templateId: 'template-2' })).toBe(
      true,
    )
    expect(
      formResponseEvidenceChanged(submitted, {
        ...submitted,
        complianceObligationId: 'obligation-2',
      }),
    ).toBe(true)
  })

  it('materializes the active old and new template targets in the caller transaction', async () => {
    const tx = {} as Database
    const before = { ...submitted, templateId: 'template-2' }
    const after = { ...submitted, templateId: 'template-1' }
    await materializeFormResponseEvidenceChange(tx, 'tenant-1', before, after)

    expect(materializeEvidence).toHaveBeenNthCalledWith(1, tx, 'tenant-1', {
      sourceModule: 'form',
      targetRef: { formTemplateId: 'template-1' },
    })
    expect(materializeEvidence).toHaveBeenNthCalledWith(2, tx, 'tenant-1', {
      sourceModule: 'form',
      targetRef: { formTemplateId: 'template-2' },
    })
  })

  it('does no evaluator work for draft-only changes', async () => {
    const draft = { ...submitted, status: 'draft', submittedAt: null }
    await materializeFormResponseEvidenceChange({} as Database, 'tenant-1', draft, {
      ...draft,
      status: 'in_progress',
    })
    expect(materializeEvidence).not.toHaveBeenCalled()
  })
})
