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

function zeroBytesBase64(bytes: number): string {
  return 'AAAA'.repeat(Math.floor(bytes / 3)) + ['', 'AA==', 'AAA='][bytes % 3]
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

  it.each([5_234_102, EMAIL_DELIVERY_LIMITS.attachmentBytes])(
    'accepts a valid %i-byte attachment without overflowing the stack',
    (size) => {
      const content = zeroBytesBase64(size)
      expect(
        normalizeEmailDeliveryInput({
          ...BASE,
          attachments: [{ filename: 'journal.pdf', content }],
        }).attachments?.[0]?.content,
      ).toBe(content)
    },
  )

  it.each(['A', 'AAA', 'A===', '====', 'AA=A', 'AA==AAAA', 'AAAA\n', 'AAA_', 'AA😀'])(
    'rejects malformed base64 %j',
    (content) => {
      expect(() =>
        normalizeEmailDeliveryInput({
          ...BASE,
          attachments: [{ filename: 'report.pdf', content }],
        }),
      ).toThrow('base64')
    },
  )

  it.each(['', 'AA==', 'AAA=', 'AAAA', '+/AA'])('accepts base64 %j', (content) => {
    expect(() =>
      normalizeEmailDeliveryInput({
        ...BASE,
        attachments: [{ filename: 'report.pdf', content }],
      }),
    ).not.toThrow()
  })

  it('rejects an invalid final character in a large attachment', () => {
    const content = 'AAAA'.repeat(2_000_000) + 'AAA!'
    expect(() =>
      normalizeEmailDeliveryInput({
        ...BASE,
        attachments: [{ filename: 'report.pdf', content }],
      }),
    ).toThrow('base64')
  })

  it('enforces decoded and aggregate attachment size limits', () => {
    const oversized = zeroBytesBase64(EMAIL_DELIVERY_LIMITS.attachmentBytes + 1)
    expect(() =>
      normalizeEmailDeliveryInput({
        ...BASE,
        attachments: [{ filename: 'report.pdf', content: oversized }],
      }),
    ).toThrow(/limit|bounded/)
    const content = zeroBytesBase64(6 * 1024 * 1024)
    expect(() =>
      normalizeEmailDeliveryInput({
        ...BASE,
        attachments: [
          { filename: 'a.pdf', content },
          { filename: 'b.pdf', content },
        ],
      }),
    ).toThrow(/attachment/i)
  })

  it('omits an empty attachment list from the normalized provider payload', () => {
    expect(normalizeEmailDeliveryInput({ ...BASE, attachments: [] })).not.toHaveProperty(
      'attachments',
    )
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
