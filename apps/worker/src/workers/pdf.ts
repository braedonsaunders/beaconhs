import type { Job } from 'bullmq'
import { eq, sql } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import {
  attachments,
  formResponses,
  formTemplateVersions,
  formTemplates,
  orgUnits,
  tenants,
} from '@beaconhs/db/schema'
import { renderFormPdf } from '@beaconhs/forms-pdf'
import type { PdfJobData } from '@beaconhs/jobs'

export async function processPdf(job: Job<PdfJobData>): Promise<void> {
  const data = job.data
  switch (data.kind) {
    case 'form_response':
      return renderFormResponse(data.tenantId, data.responseId)
    case 'certificate':
    case 'report':
      console.warn(`[pdf] ${data.kind} renderer not yet implemented`)
      return
  }
}

async function renderFormResponse(tenantId: string, responseId: string): Promise<void> {
  const result = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        response: formResponses,
        template: formTemplates,
        version: formTemplateVersions,
        site: orgUnits,
        tenant: tenants,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .innerJoin(tenants, eq(tenants.id, formResponses.tenantId))
      .where(eq(formResponses.id, responseId))
      .limit(1)
    return row
  })

  if (!result) {
    console.warn(`[pdf] form_response ${responseId} not found`)
    return
  }

  const pdf = await renderFormPdf({
    schema: result.version.schema,
    values: result.response.data,
    metadata: {
      title: typeof result.version.schema.title === 'object'
        ? (result.version.schema.title.en ?? result.template.name)
        : result.template.name,
      reference: result.response.id.slice(0, 8),
      submittedAt: result.response.submittedAt?.toISOString().slice(0, 19).replace('T', ' '),
      siteName: result.site?.name,
      tenantName: result.tenant.name,
      tenantLogoUrl: result.tenant.branding.logoUrl,
      primaryColor: result.tenant.branding.primaryColor,
    },
    customCss: result.version.schema.pdf?.css,
    customHeaderHtml: result.version.schema.pdf?.header,
    customFooterHtml: result.version.schema.pdf?.footer,
    pageSize: result.version.schema.pdf?.pageSize ?? 'Letter',
  })

  // Upload to R2 (TODO: wire S3 client) — for now, log size.
  console.log(`[pdf] rendered form_response ${responseId} (${pdf.length} bytes)`)

  // Persist attachment row with placeholder r2 key
  const r2Key = `pdfs/forms/${responseId}.pdf`
  await withTenant(db, tenantId, async (tx) => {
    const [att] = await tx
      .insert(attachments)
      .values({
        tenantId,
        kind: 'document',
        r2Key,
        contentType: 'application/pdf',
        sizeBytes: pdf.length,
        filename: `form-${responseId.slice(0, 8)}.pdf`,
      })
      .returning()
    if (att) {
      await tx
        .update(formResponses)
        .set({ pdfAttachmentId: att.id })
        .where(eq(formResponses.id, responseId))
    }
  })
}
