import { describe, expect, it } from 'vitest'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { copyHazidAppPayload } from './hazid-copy-payload'

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  workflow: {
    steps: [{ key: 'submit', title: { en: 'Submit' }, assignee: { type: 'role', role: 'worker' } }],
  },
  title: { en: 'Plan' },
  sections: [
    {
      id: 'plan',
      title: { en: 'Plan' },
      fields: [
        { id: 'description', type: 'long_text', label: { en: 'Work' } },
        { id: 'work_date', type: 'date', label: { en: 'Date' }, defaultValue: { kind: 'today' } },
        { id: 'certificate_date', type: 'date', label: { en: 'Certificate date' } },
        { id: 'signature', type: 'signature', label: { en: 'Signature' } },
        { id: 'photos', type: 'photo', label: { en: 'Photos' } },
        { id: 'rescue_plan', type: 'file', label: { en: 'Rescue plan' } },
      ],
    },
    {
      id: 'crew',
      title: { en: 'Crew' },
      repeating: true,
      fields: [
        { id: 'name', type: 'text', label: { en: 'Name' } },
        { id: 'ink', type: 'signature', label: { en: 'Sign' } },
      ],
    },
    {
      id: 'atmospheric_readings',
      title: { en: 'Readings' },
      repeating: true,
      fields: [{ id: 'oxygen_pct', type: 'number', label: { en: 'Oxygen' } }],
    },
    {
      id: 'entry_log',
      title: { en: 'Entry log' },
      repeating: true,
      fields: [{ id: 'entrant', type: 'text', label: { en: 'Entrant' } }],
    },
  ],
}
const payload = {
  description: 'Anchor A; rescue by lift',
  work_date: '2026-10-01',
  certificate_date: '2026-02-01',
  signature: { attachmentId: 'old-ink' },
  photos: { attachments: [{ attachmentId: 'photo-1' }] },
  rescue_plan: [{ attachmentId: 'procedure-1' }],
  crew: [{ name: 'Worker', ink: { attachmentId: 'crew-ink' } }],
  atmospheric_readings: [{ oxygen_pct: 20.9 }],
  entry_log: [{ entrant: 'Worker' }],
  all_entrants_out: 'yes',
}
describe('assessment plan carry-forward', () => {
  it('keeps work details and documents, refreshes the work date, removes every signature and leaves the source untouched', () => {
    const copy = copyHazidAppPayload(schema, payload, {
      templateKey: 'hazid-fall-protection-plan',
      date: '2026-10-20',
      includePhotos: false,
    })
    expect(copy).toMatchObject({
      description: payload.description,
      work_date: '2026-10-20',
      certificate_date: '2026-02-01',
      rescue_plan: payload.rescue_plan,
      crew: [{ name: 'Worker' }],
    })
    expect(copy.signature).toBeUndefined()
    expect(copy.photos).toBeUndefined()
    expect((copy.crew as Record<string, unknown>[])[0]?.ink).toBeUndefined()
    expect(payload.signature.attachmentId).toBe('old-ink')
    expect(payload.crew[0]?.ink.attachmentId).toBe('crew-ink')
  })
  it('only carries photos when explicitly requested', () => {
    expect(
      copyHazidAppPayload(schema, payload, {
        templateKey: 'custom-plan',
        date: '2026-10-20',
        includePhotos: true,
      }).photos,
    ).toEqual(payload.photos)
  })
  it('requires fresh confined-space measurements, entries and exit confirmation', () => {
    const copy = copyHazidAppPayload(schema, payload, {
      templateKey: 'hazid-confined-space-entry-plan',
      date: '2026-10-20',
      includePhotos: false,
    })
    expect(copy.atmospheric_readings).toEqual([])
    expect(copy.entry_log).toEqual([])
    expect(copy.all_entrants_out).toBeUndefined()
    expect(copy.description).toBe(payload.description)
    expect(payload.atmospheric_readings).toHaveLength(1)
  })
})
