import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { buildSubjectPdfJob } from './pdf-document'
import type { FlowSubjectAdapter } from './types'
import type { PdfTemplateRenderConfig } from '@/lib/pdf-templates'

const template: PdfTemplateRenderConfig = {
  id: 'template',
  compiledHtml: '<h1>{{reference}}</h1>',
  paperSize: 'letter',
  orientation: 'portrait',
  marginMm: 14,
  headerHtml: '{{reference}}',
  footerHtml: '{{page}} / {{pages}}',
}
function adapter(appendices: FlowSubjectAdapter['pdfAppendices']): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'hazid',
    subjectId: 'assessment',
    notifyCategory: 'hazid',
    auditEntityType: 'hazid_assessment',
    deepLink: () => '/record',
    loadValues: async () => ({}),
    resolveSubmitter: async () => ({ tenantUserId: null, userId: null, email: null }),
    pdfAppendices: appendices,
  }
}
it('bundles the complete assessment with each configured plan in order, retaining independent page setups', async () => {
  const plans = [
    {
      html: '<h1>Fall protection</h1><p>Rescue by lift</p>',
      paperSize: 'a4' as const,
      orientation: 'landscape' as const,
      marginMm: 10,
    },
  ]
  const job = await buildSubjectPdfJob(
    adapter(async () => plans),
    { reference: 'JSA-001' },
    { tenantId: 'tenant', template, filename: 'JSA-001.pdf' },
  )
  expect(job.kind).toBe('document_bundle')
  if (job.kind !== 'document_bundle') throw Error('Expected complete bundle')
  expect(job.parts).toHaveLength(2)
  expect(job.parts[0]?.html).toBe('<h1>JSA-001</h1>')
  expect(job.parts[0]?.footerHtml).toBe('{{page}} / {{pages}}')
  expect(job.parts[1]).toEqual(plans[0])
})
it('keeps attached plans even when the assessment uses the summary fallback', async () => {
  const job = await buildSubjectPdfJob(
    adapter(async () => [
      { html: '<p>PLAN CONTENT</p>', paperSize: 'letter', orientation: 'portrait', marginMm: 12 },
    ]),
    { reference: 'JSA-002', job_scope: 'Repair platform' },
    { tenantId: 'tenant', template: null, filename: 'JSA-002.pdf' },
  )
  expect(job.kind).toBe('document_bundle')
  if (job.kind === 'document_bundle') {
    expect(job.parts[0]?.html).toContain('Repair platform')
    expect(job.parts[1]?.html).toContain('PLAN CONTENT')
  }
})
it('fails the export rather than silently issuing an incomplete assessment if a plan cannot load', async () => {
  await expect(
    buildSubjectPdfJob(
      adapter(async () => {
        throw Error('Plan lookup failed')
      }),
      {},
      { tenantId: 'tenant', template, filename: 'record.pdf' },
    ),
  ).rejects.toThrow('Plan lookup failed')
})
it('preserves the configured single-template path when there are no plans', async () => {
  const job = await buildSubjectPdfJob(
    adapter(undefined),
    { reference: 'JSA-003' },
    { tenantId: 'tenant', template, filename: 'JSA-003.pdf' },
  )
  expect(job).toMatchObject({
    kind: 'template_pdf',
    html: '<h1>JSA-003</h1>',
    filename: 'JSA-003.pdf',
  })
})
