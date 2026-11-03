import { writeFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { MODULE_PDF_TEMPLATE_SEEDS } from '@beaconhs/db/seed/pdf-templates'
import { expandRepeatMarkers, renderTemplate } from '@beaconhs/email-render'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { getBrowser } from '../../../../packages/forms-pdf/src/util'

const template = MODULE_PDF_TEMPLATE_SEEDS.find((seed) => seed.key === 'vehicle-log-month-pdf')!
// Allow the renderer's bounded 120-second cold start to finish before cleanup.
afterAll(async () => {
  await (await getBrowser()).close()
}, 180_000)

describe('monthly vehicle-log portrait PDF', () => {
  it.each(['odometer', 'destination'])(
    'fits all 31 %s days and totals on one portrait page',
    async (mode) => {
      const entries = Array.from({ length: 31 }, (_, index) => ({
        day: index + 1,
        weekday: new Date(Date.UTC(2026, 9, index + 1)).toLocaleDateString('en', {
          weekday: 'short',
          timeZone: 'UTC',
        }),
        is_weekend: index % 7 === 2 || index % 7 === 3,
        site_name: mode === 'destination' ? 'The Shop' : '',
        other_destination: '',
        start_odometer: mode === 'odometer' ? 120000 + index * 150 : '',
        end_odometer: mode === 'odometer' ? 120150 + index * 150 : '',
        business_km: 140,
        personal_km: 10,
        total_km: 150,
        notes: '',
      }))
      const values = {
        is_odometer: mode === 'odometer',
        month_key: '2026-10',
        month_label: 'October 2026',
        driver_name: 'Example driver',
        driver_employee_no: '',
        vehicle_name: '22F-1 Ford F150 XLT',
        entries,
        month_business_km: 4340,
        month_personal_km: 310,
        month_total_km: 4650,
        month_days_logged: 31,
      }
      const html = renderTemplate(expandRepeatMarkers(template.html), values, { escapeHtml: true })
      expect(template.orientation).toBe('portrait')
      expect(html).toContain('31 Sat')
      expect(html).toContain('4650')
      expect(html).not.toContain('Employee #')
      expect(html).not.toMatch(/>Hours<|>Crew</)
      expect(html.match(/<th\b/g)).toHaveLength(mode === 'odometer' ? 5 : 6)
      expect(html).toContain('background:#d1d5db')
      expect(html).not.toContain(mode === 'odometer' ? 'Customer / site' : 'Start odo')
      expect(html).not.toContain('{{')
      const pdf = await renderHtmlDocumentPdf({
        bodyHtml: html,
        paperSize: 'letter',
        orientation: template.orientation,
        marginMm: 14,
        headerHtml: 'Vehicle log October 2026',
        footerHtml: 'Page {{page}} of {{pages}}',
      })
      await writeFile(`/tmp/beacon-vehicle-${mode}.pdf`, pdf)
      expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1)
      expect(pdf.toString('latin1')).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/)
    },
    180000,
  )
})
