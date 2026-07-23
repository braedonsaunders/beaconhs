import { describe, expect, it, vi } from 'vitest'
import type { FormField } from '@beaconhs/forms-core'

vi.mock('server-only', () => ({}))

import { nestedPhotoRows, renderFormFieldText } from './form-subject-values'

const photoField: FormField = {
  id: 'evidence',
  type: 'photo',
  label: { en: 'Evidence' },
}

describe('Builder photo document values', () => {
  it('renders an unset optional photo without throwing', () => {
    expect(renderFormFieldText(photoField, undefined)).toBe('')
    expect(renderFormFieldText(photoField, 'legacy-invalid-value')).toBe('0 photos')
  })

  it('includes captions and migrated text annotations in readable output', () => {
    expect(
      renderFormFieldText(photoField, {
        attachments: [
          {
            caption: 'Guardrail opening',
            annotations: [
              {
                type: 'text',
                text: '1. Missing midrail',
              },
              {
                type: 'free',
                points: [[10, 20]],
              },
            ],
          },
        ],
      }),
    ).toBe('1 photo; Notes: Guardrail opening; 1. Missing midrail')
  })

  it('projects captions and marked-up image URLs for PDF and Flow collections', () => {
    const [row] = nestedPhotoRows({
      attachments: [
        {
          filename: 'guardrail.jpg',
          url: '/api/attachments/10000000-0000-4000-8000-000000000001?cap=token',
          caption: 'North edge',
          width: 800,
          height: 600,
          annotations: [
            {
              type: 'free',
              points: [
                [10, 20],
                [30, 40],
              ],
              color: '#ef4444',
              width: 8,
            },
          ],
        },
      ],
    })

    expect(row).toMatchObject({
      filename: 'guardrail.jpg',
      caption: 'North edge',
    })
    expect(row?.url).toMatch(/^data:image\/svg\+xml;base64,/)
  })
})
