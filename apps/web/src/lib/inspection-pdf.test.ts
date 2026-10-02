import { afterAll, describe, expect, it } from 'vitest'
import { MODULE_PDF_TEMPLATE_SEEDS } from '@beaconhs/db/seed/pdf-templates'
import { expandRepeatMarkers, renderTemplate } from '@beaconhs/email-render'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { getBrowser } from '../../../../packages/forms-pdf/src/util'
import sharp from 'sharp'
import { extractText } from 'unpdf'

const template = MODULE_PDF_TEMPLATE_SEEDS.find((seed) => seed.subjectKey === 'inspections')!
afterAll(async () => {
  await (await getBrowser()).close()
})

describe('inspection report layout', () => {
  it('keeps narrative answers readable and places portrait photos in a contact sheet', async () => {
    const png = await sharp({
      create: { width: 600, height: 1000, channels: 3, background: '#526c88' },
    })
      .png()
      .toBuffer()
    const photo = `data:image/png;base64,${png.toString('base64')}`
    const values = {
      reference: 'INS-TEST',
      type_name: 'Management inspection',
      status_label: 'Submitted',
      occurred_at: 'October 2, 2026',
      inspector_name: 'Example inspector',
      supervisor_name: 'Example supervisor',
      site_name: 'Shop',
      criteria: [
        {
          group: 'General',
          question: 'Explain the finding',
          answer: 'Detailed explanation. '.repeat(120) + 'END OF LONG ANSWER',
          notes: 'Context for this failed finding.',
          non_compliance: 'The access route needed clearing.',
          action_taken: 'Access cleared before work resumed.',
          severity: 'High',
          resolution: 'Resolved on site',
          corrected_on: '2026-10-02',
        },
      ],
      photos: Array.from({ length: 6 }, (_, i) => ({
        url: photo,
        caption: `Photo ${i + 1} - retained caption`,
      })),
    }
    const html = renderTemplate(expandRepeatMarkers(template.html), values, { escapeHtml: true })
    expect(html).not.toContain('{{')
    const pdf = await renderHtmlDocumentPdf({
      bodyHtml: html,
      paperSize: 'letter',
      orientation: 'portrait',
      marginMm: 14,
    })
    const result = await extractText(new Uint8Array(pdf), { mergePages: true })
    expect(result.text).toContain('Example supervisor')
    expect(result.text).toContain('END OF LONG ANSWER')
    expect(result.text).toContain('Context for this failed finding.')
    expect(result.text).toContain('Resolved on site')
    expect(result.text).toContain('2026-10-02')
    expect(result.text).toContain('Photo 6 - retained caption')
    expect(result.totalPages).toBeLessThanOrEqual(4)
    if (process.env.BEACON_PDF_REVIEW_PATH) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(process.env.BEACON_PDF_REVIEW_PATH, pdf)
    }
  }, 180000)
})

describe('training assessment PDF', () => {
  it('prints choice options, readable answers, and distinct correct and incorrect results', async () => {
    const training = MODULE_PDF_TEMPLATE_SEEDS.find((seed) => seed.subjectKey === 'training')!
    const html = renderTemplate(
      expandRepeatMarkers(training.html),
      {
        assessment_name: 'Equipment safety',
        person_name: 'Example learner',
        status_label: 'Submitted',
        pass_fail: 'Pass',
        questions: [
          {
            prompt: 'First question: select the safe action',
            options_text: '1. Isolate the energy source\n2. Start work',
            answer: 'Isolate the energy source',
            correct_answer: 'Isolate the energy source',
            result: 'Correct',
            is_correct: true,
            is_incorrect: false,
            points: '1/1',
          },
          {
            prompt: 'Second question: the statement is true',
            answer: 'False',
            correct_answer: 'True',
            result: 'Incorrect',
            is_correct: false,
            is_incorrect: true,
            points: '0/1',
          },
        ],
      },
      { escapeHtml: true },
    )
    expect(html).not.toContain('{{')
    expect(html).toContain('✓ Correct')
    expect(html).toContain('✗ Incorrect')
    const pdf = await renderHtmlDocumentPdf({
      bodyHtml: html,
      paperSize: 'letter',
      orientation: 'portrait',
      marginMm: 14,
    })
    const result = await extractText(new Uint8Array(pdf), { mergePages: true })
    expect(result.text.indexOf('First question')).toBeLessThan(
      result.text.indexOf('Second question'),
    )
    expect(result.text).toContain('2. Start work')
    expect(result.text).toContain('Isolate the energy source')
    expect(result.text).toContain('False')
    expect(result.text).toContain('True')
    if (process.env.BEACON_PDF_REVIEW_PATH) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(process.env.BEACON_PDF_REVIEW_PATH.replace('.pdf', '-training.pdf'), pdf)
    }
  }, 180000)
})
