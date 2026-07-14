import { describe, expect, it } from 'vitest'

import {
  EMAIL_DELIVERY_LIMITS,
  normalizeEmailDeliveryInput,
  type EmailDeliveryInput,
} from './delivery-input'

const BASE: EmailDeliveryInput = {
  to: 'recipient@example.com',
  subject: '  Safety\r\n update  ',
  html: '<p>Safe</p>',
  text: 'Safe',
}

describe('normalizeEmailDeliveryInput', () => {
  it('normalizes the subject and deduplicates trimmed recipients case-insensitively', () => {
    expect(
      normalizeEmailDeliveryInput({
        ...BASE,
        to: [' First@Example.com ', 'first@example.com', 'second@example.com'],
      }),
    ).toMatchObject({
      to: ['First@Example.com', 'second@example.com'],
      subject: 'Safety update',
    })
  })

  it('requires one provider recipient so fan-out cannot expose addresses', () => {
    expect(() =>
      normalizeEmailDeliveryInput(
        { ...BASE, to: ['first@example.com', 'second@example.com'] },
        { requireSingleRecipient: true },
      ),
    ).toThrow('exactly one recipient')
  })

  it.each([
    '',
    'missing-at.example.com',
    'two@@example.com',
    'linebreak@example.com\r\nBcc: victim@example.com',
    'local@localhost',
  ])('rejects invalid recipient %j', (to) => {
    expect(() => normalizeEmailDeliveryInput({ ...BASE, to })).toThrow('invalid recipient')
  })

  it('rejects an enqueue fan-out above the hard ceiling before deduplication', () => {
    const to = Array.from(
      { length: EMAIL_DELIVERY_LIMITS.recipientsPerEnqueue + 1 },
      (_, index) => `person-${index}@example.com`,
    )
    expect(() => normalizeEmailDeliveryInput({ ...BASE, to })).toThrow('recipient enqueue limit')
  })

  it('bounds body bytes, including multi-byte text', () => {
    expect(() =>
      normalizeEmailDeliveryInput({
        ...BASE,
        html: '😀'.repeat(Math.floor(EMAIL_DELIVERY_LIMITS.htmlBytes / 4) + 1),
      }),
    ).toThrow('Email HTML exceeds')
    expect(() => normalizeEmailDeliveryInput({ ...BASE, html: '', text: '' })).toThrow(
      'HTML or text content',
    )
  })

  it('accepts bounded base64 attachments without decoding them', () => {
    expect(
      normalizeEmailDeliveryInput({
        ...BASE,
        attachments: [{ filename: 'report.pdf', content: 'cGRm', contentType: 'application/pdf' }],
      }).attachments,
    ).toHaveLength(1)
  })

  it.each([
    { filename: '../report.pdf', content: 'cGRm', contentType: 'application/pdf' },
    { filename: 'report.pdf', content: 'not base64!', contentType: 'application/pdf' },
    { filename: 'report.pdf', content: 'cGRm', contentType: 'text/plain\r\nX-Evil: 1' },
  ])('rejects malformed attachment metadata or content', (attachment) => {
    expect(() => normalizeEmailDeliveryInput({ ...BASE, attachments: [attachment] })).toThrow(
      /invalid|base64/,
    )
  })
})
