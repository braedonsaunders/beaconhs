import { afterAll, describe, expect, it, vi } from 'vitest'
import type { PDFOptions } from 'puppeteer-core'
import { getBrowser } from './util'
import { renderReportPdf } from './index'

// A cold Chromium launch and full document print can exceed Vitest's default
// timeout on shared CI runners. The package runs test files serially so the
// browser-backed regressions do not compete for runner resources.
const RENDER_TEST_TIMEOUT_MS = 180_000

describe('AppKit report PDF document', () => {
  afterAll(async () => {
    await (await getBrowser()).close()
  }, RENDER_TEST_TIMEOUT_MS)
  it(
    'prints the canonical seeded layout on portrait Letter paper',
    async () => {
      const pdf = await renderReportPdf({
        tenantName: 'Rassaun Services',
        reportName: 'Training — Expired & Upcoming',
        dateRangeLabel: 'Expired certificates and certificates expiring within 90 days.',
        generatedAt: new Date('2026-07-24T14:00:00Z'),
        layout: {
          paperSize: 'letter',
          orientation: 'portrait',
          marginMm: 15,
          showSummary: true,
          density: 'standard',
        },
        summary: [{ key: 'rows', label: 'Rows', value: 2 }],
        groups: [
          {
            title: 'Anderson, Sean',
            columns: [
              { key: 'employee', label: 'Employee', semanticType: 'category' },
              { key: 'course', label: 'Course', semanticType: 'category' },
              { key: 'expires', label: 'Expires on', semanticType: 'date' },
              { key: 'coverage', label: 'Coverage', semanticType: 'category' },
            ],
            rows: [
              {
                employee: 'Anderson, Sean',
                course: 'Confined Space Entry',
                expires: '2026-06-01',
                coverage: 'Expired',
              },
              {
                employee: 'Anderson, Sean',
                course: 'Working at Heights',
                expires: '2026-09-03',
                coverage: 'Expiring',
              },
            ],
          },
        ],
      })

      expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF')
      expect(pdf.toString('latin1')).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/)
      expect(pdf.toString('latin1')).toMatch(/Geist-(?:Regular|SemiBold)/)
      expect(pdf.toString('latin1')).not.toContain('Times-Roman')
    },
    RENDER_TEST_TIMEOUT_MS,
  )
  it(
    'prints page counters and a zoned timestamp on a tightly packed multi-page report',
    async () => {
      const browser = await getBrowser()
      const originalNewPage = browser.newPage.bind(browser)
      let options: PDFOptions | undefined
      const newPage = vi.spyOn(browser, 'newPage').mockImplementation(async () => {
        const page = await originalNewPage()
        const originalPdf = page.pdf.bind(page)
        vi.spyOn(page, 'pdf').mockImplementation(async (value) => {
          options = value
          return originalPdf(value)
        })
        return page
      })
      try {
        const pdf = await renderReportPdf({
          tenantName: 'Rassaun Services',
          reportName: 'Training — Missing',
          dateRangeLabel: 'Required training',
          generatedAt: new Date('2026-07-24T14:00:00Z'),
          timezone: 'America/Toronto',
          locale: 'en-CA',
          layout: { marginMm: 5 },
          groups: [
            {
              title: 'Employees',
              columns: ['Employee', 'Course', 'Coverage'],
              rows: Array.from({ length: 160 }, (_, index) => [
                `Employee ${index + 1}`,
                'Working at Heights',
                'Booked',
              ]),
            },
          ],
        })
        expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1)
        expect(options).toMatchObject({
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',
          margin: { top: '5mm', bottom: '12mm', left: '5mm', right: '5mm' },
        })
        expect(options?.footerTemplate).toContain('Printed Jul 24, 2026, 10:00:00 a.m. EDT')
        expect(options?.footerTemplate).toContain('class="pageNumber"')
        expect(options?.footerTemplate).toContain('class="totalPages"')
        expect(options?.footerTemplate).toContain('AppKit Report Sans')
      } finally {
        newPage.mockRestore()
      }
    },
    RENDER_TEST_TIMEOUT_MS,
  )
})
