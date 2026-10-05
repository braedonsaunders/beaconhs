import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { MODULE_PDF_TEMPLATE_SEEDS } from '@beaconhs/db/seed/pdf-templates'
import { expandRepeatMarkers, renderTemplate } from '@beaconhs/email-render'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { getBrowser } from '../../../../packages/forms-pdf/src/util'
import { extractText } from 'unpdf'
import { buildBlankTrainingAssessmentHtml } from './training-assessment-blank-pdf'

const reviewDir = process.env.BEACON_TRAINING_PDF_REVIEW_DIR

afterAll(async () => {
  await (await getBrowser()).close()
})

async function print(html: string, name: string) {
  const pdf = await renderHtmlDocumentPdf({
    bodyHtml: html,
    paperSize: 'letter',
    orientation: 'portrait',
    marginMm: 14,
  })
  if (reviewDir) {
    await mkdir(reviewDir, { recursive: true })
    await writeFile(`${reviewDir}/${name}.pdf`, pdf)
  }
  return extractText(new Uint8Array(pdf), { mergePages: true })
}

describe('training paper forms', () => {
  it('prints the attendance sheet without course prose and wraps long email addresses', async () => {
    const template = MODULE_PDF_TEMPLATE_SEEDS.find(
      (seed) => seed.subjectKey === 'training-classes',
    )!
    const html = renderTemplate(
      expandRepeatMarkers(template.html),
      {
        title: 'Mobile crane operator class',
        course_name: '8 T Mobile Crane Operator Training',
        course_code: 'CRANE',
        status_label: 'Scheduled',
        starts_at: '2026-10-30 07:30',
        ends_at: '2026-10-30 14:00',
        site_name: 'Shop classroom, 12 Main Street',
        instructor_name: 'Training instructor',
        capacity: 8,
        attendee_count: 2,
        attended_count: 0,
        absent_count: 0,
        course_description: 'COURSE_PROSE_MUST_NOT_PRINT',
        notes: '',
        attendees: [
          { name: 'Matt Fisher', email: 'ffindustrialinc@gmail.com', status: 'Registered' },
          {
            name: 'Blaize Mann',
            email: 'blaize.mann@mannindustrialgroup.com',
            status: 'Registered',
          },
        ],
      },
      { escapeHtml: true },
    )
    const result = await print(html, 'class-attendance')
    expect(result.text).not.toContain('COURSE_PROSE_MUST_NOT_PRINT')
    expect(result.text).not.toContain('About this course')
    expect(result.text).toContain('2026-10-30 14:00')
    expect(result.text).toContain('Shop classroom')
    expect(result.text).toContain('SIGNATURE')
    expect(result.totalPages).toBe(1)
    const browser = await getBrowser()
    const page = await browser.newPage()
    try {
      await page.setViewport({ width: 710, height: 900 })
      await page.setContent(html)
      const cell = await page.$eval(
        'table:has(thead) tbody tr:last-child td:nth-child(3)',
        (element) => {
          const box = element.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(element)
          return {
            left: box.left,
            right: box.right,
            lines: [...range.getClientRects()].map((rect) => ({
              left: rect.left,
              right: rect.right,
            })),
          }
        },
      )
      expect(cell.lines.length).toBeGreaterThan(1)
      for (const line of cell.lines) {
        expect(line.left).toBeGreaterThanOrEqual(cell.left)
        expect(line.right).toBeLessThanOrEqual(cell.right)
      }
    } finally {
      await page.close()
    }
  }, 30_000)

  it('prints a multi-page blank assessment with choices and handwriting room', async () => {
    const questions = Array.from({ length: 12 }, (_, index) => ({
      prompt: `Question ${index + 1}: Describe the checks before operating the crane.`,
      kind: 'text' as const,
      options: null,
      helpText: 'Explain in your own words.',
      mandatory: true,
    }))
    const html = buildBlankTrainingAssessmentHtml(
      {
        name: 'Crane operator assessment',
        description: 'Complete by hand.',
        preAssessmentMessage: 'Read all questions before answering.',
      },
      [
        {
          prompt: 'Select the safe action.',
          kind: 'single_choice',
          options: [
            { value: 'a', label: 'Stop and inspect the load.' },
            { value: 'b', label: 'Continue without a check.' },
          ],
          helpText: null,
          mandatory: true,
        },
        {
          prompt: 'The operator must inspect the crane.',
          kind: 'true_false',
          options: null,
          helpText: null,
          mandatory: true,
        },
        ...questions,
      ],
    )
    const result = await print(html, 'blank-assessment')
    expect(result.text).toContain('Stop and inspect the load.')
    expect(result.text).toContain('True')
    expect(result.text).toContain('False')
    expect(result.text).toContain('Question 12:')
    expect(result.text).toContain('Signature:')
    expect(result.totalPages).toBeGreaterThan(1)
  }, 30_000)
})
