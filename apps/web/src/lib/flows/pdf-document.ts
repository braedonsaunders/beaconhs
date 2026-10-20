import 'server-only'

import { renderTemplate } from '@beaconhs/email-render'
import { renderRecordSummaryHtml } from '@beaconhs/forms-pdf'
import type { OnDemandPdfJobData, PdfJobData, RecordSummaryPdfJobData } from '@beaconhs/jobs'
import type { PdfTemplateRenderConfig } from '@/lib/pdf-templates'
import type { FlowSubjectAdapter } from './types'
import { buildRecordSummaryPdfJob } from './pdf-summary'

type PdfPart = Extract<PdfJobData, { kind: 'document_bundle' }>['parts'][number]
type PrintableJob = Extract<
  OnDemandPdfJobData,
  { kind: 'record_summary' | 'template_pdf' | 'document_bundle' }
>

/** Shared by downloads and email flows, including attached assessment plans. */
export function buildTemplatePdfPart(
  template: PdfTemplateRenderConfig,
  values: Record<string, unknown>,
): PdfPart {
  const headerValues = { ...values, page: '{{page}}', pages: '{{pages}}' }
  return {
    html: renderTemplate(template.compiledHtml, values, { escapeHtml: true }),
    paperSize: template.paperSize,
    orientation: template.orientation,
    marginMm: template.marginMm,
    headerHtml: template.headerHtml
      ? renderTemplate(template.headerHtml, headerValues, { escapeHtml: false })
      : null,
    footerHtml: template.footerHtml
      ? renderTemplate(template.footerHtml, headerValues, { escapeHtml: false })
      : null,
  }
}

export function buildSummaryPdfPart(summary: RecordSummaryPdfJobData): PdfPart {
  return {
    html: renderRecordSummaryHtml({ ...summary, tenantName: '' }),
    paperSize: 'letter',
    orientation: 'portrait',
    marginMm: 12,
    footerHtml: '{{page}} / {{pages}}',
  }
}

export async function buildSubjectPdfJob(
  adapter: FlowSubjectAdapter,
  values: Record<string, unknown>,
  options: {
    tenantId: string
    template: PdfTemplateRenderConfig | null
    filename: string
  },
): Promise<PrintableJob> {
  const summary = () =>
    adapter.pdfJob?.(values) ??
    buildRecordSummaryPdfJob({
      tenantId: options.tenantId,
      subjectId: adapter.subjectId,
      entityType: adapter.auditEntityType,
      heading: adapter.auditEntityType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      reference: values.reference,
      subtitle: values.title,
      values,
    })
  const main = options.template ? buildTemplatePdfPart(options.template, values) : null
  const appendices = (await adapter.pdfAppendices?.()) ?? []
  if (appendices.length)
    return {
      kind: 'document_bundle',
      tenantId: options.tenantId,
      entityType: adapter.auditEntityType,
      entityId: adapter.subjectId,
      filename: options.filename,
      parts: [main ?? buildSummaryPdfPart(summary()), ...appendices],
    }
  return main
    ? {
        kind: 'template_pdf',
        tenantId: options.tenantId,
        ...main,
        entityType: adapter.auditEntityType,
        entityId: adapter.subjectId,
        filename: options.filename,
      }
    : { ...summary(), filename: options.filename }
}
