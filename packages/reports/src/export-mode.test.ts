import { describe, expect, it } from 'vitest'
import { reportExportMode, reportExportsCredentialFronts } from './export-mode'

describe('report PDF export mode', () => {
  it('defaults to the paper document', () => {
    expect(reportExportMode(null)).toBe('document')
    expect(reportExportMode({})).toBe('document')
    expect(reportExportsCredentialFronts({ exportMode: 'document' })).toBe(false)
  })

  it('recognizes credential-front wallet PDFs', () => {
    expect(reportExportMode({ exportMode: 'credential-fronts' })).toBe('credential-fronts')
    expect(reportExportsCredentialFronts({ exportMode: 'credential-fronts' })).toBe(true)
  })
})
