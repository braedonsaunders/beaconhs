import { describe, expect, it } from 'vitest'
import { renderReportPdf } from './index'

// A cold Chromium launch can be delayed while the package's PNG regression
// runs concurrently on shared CI runners. The render itself retains its own
// bounded page timeouts; this outer bound matches the existing browser test.
const RENDER_TEST_TIMEOUT_MS = 90_000

describe('AppKit report PDF document', () => {
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
    },
    RENDER_TEST_TIMEOUT_MS,
  )
})
