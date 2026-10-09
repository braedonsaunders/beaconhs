import { describe, expect, it } from 'vitest'
import {
  addUtcDays,
  classifyTrainingExpiry,
  toPlateCompliance,
  type CompliancePlateSource,
} from './plate-model'
import { assistantSystemPrompt } from './system-prompt'

function row(
  partial: Partial<CompliancePlateSource> &
    Pick<CompliancePlateSource, 'status' | 'title' | 'kind'>,
): CompliancePlateSource {
  return {
    obligationId: partial.title,
    dueOn: null,
    targetRef: partial.kind === 'document' ? { documentId: 'doc-1' } : null,
    subjectRef: null,
    ...partial,
  }
}

describe('assistant plate', () => {
  it('classifies training expiry against today, not a guessed window', () => {
    expect(addUtcDays('2026-10-09', 90)).toBe('2027-01-07')
    expect(classifyTrainingExpiry('2024-10-04', '2026-10-09', '2027-01-07')).toBe('expired')
    expect(classifyTrainingExpiry('2026-11-27', '2026-10-09', '2027-01-07')).toBe('expiring')
    expect(classifyTrainingExpiry('2027-06-01', '2026-10-09', '2027-01-07')).toBeNull()
    expect(classifyTrainingExpiry(null, '2026-10-09', '2027-01-07')).toBeNull()
  })

  it('keeps outstanding obligations and links a document acknowledgement to the reader', () => {
    const plate = toPlateCompliance(
      [
        row({
          kind: 'document',
          title: 'Site orientation',
          status: 'overdue',
          dueOn: '2026-10-01',
        }),
        row({ kind: 'training', title: 'WHMIS', status: 'completed' }),
        row({ kind: 'form', title: 'Daily FLHA', status: 'pending' }),
      ],
      'person-1',
    )
    expect(plate.outstanding).toBe(2)
    expect(plate.overdue).toBe(1)
    expect(plate.items.map((item) => item.title)).toEqual(['Site orientation', 'Daily FLHA'])
    expect(plate.items[0]).toMatchObject({
      kindLabel: 'Document acknowledgement',
      href: '/documents/doc-1/read',
      action: 'Acknowledge',
    })
  })

  it('tells the assistant to answer a plate question from compliance, not training alone', () => {
    const prompt = assistantSystemPrompt({
      orgName: 'Rassaun',
      userName: 'Adam',
      today: '2026-10-09',
      canWrite: false,
    })
    expect(prompt).toContain('list_my_open_items')
    expect(prompt).toContain('documents to acknowledge')
    expect(prompt).toContain('find_person_compliance')
    expect(prompt).toContain('find_compliance_gaps')
  })
})
