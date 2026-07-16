import 'server-only'

import ExcelJS from 'exceljs'
import { and, eq, inArray } from 'drizzle-orm'
import { attachments } from '@beaconhs/db/schema'
import type { EmailAttachment } from '@beaconhs/jobs'
import { getObject } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024
const MAX_WORKBOOK_CELLS = 250_000

type SpreadsheetAttachmentConfig = {
  templateAttachmentId: string
  filename?: string
}

type SignatureValue = {
  name?: unknown
  attachment_id?: unknown
  covid_result?: unknown
}

function scalarText(value: unknown): string | number | boolean | Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (value == null) return ''
  if (Array.isArray(value)) return value.map((item) => scalarText(item)).join('')
  return String(value)
}

function safeFilename(configured: string | undefined, original: string): string {
  const candidate = (configured?.trim() || original).replace(/[\x00-\x1f\x7f/\\]/g, '-')
  const withExtension = candidate.toLowerCase().endsWith('.xlsx') ? candidate : `${candidate}.xlsx`
  return withExtension.slice(0, 255)
}

function signatureValues(values: Record<string, unknown>): SignatureValue[] {
  if (!Array.isArray(values.signatures)) return []
  return values.signatures.filter(
    (value): value is SignatureValue => Boolean(value) && typeof value === 'object',
  )
}

function additionalInformation(values: Record<string, unknown>): Map<string, unknown> {
  const result = new Map<string, unknown>()
  if (!Array.isArray(values.questions)) return result
  for (const entry of values.questions) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    if (typeof row.question === 'string') result.set(row.question, row.answer)
  }
  return result
}

async function loadSignatureImages(
  ctx: RequestContext,
  signatures: SignatureValue[],
): Promise<Map<string, { bytes: Buffer; extension: 'png' | 'jpeg' }>> {
  const ids = [
    ...new Set(
      signatures
        .map((signature) => signature.attachment_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]
  if (ids.length === 0) return new Map()
  const rows = await ctx.db((tx) =>
    tx
      .select({ id: attachments.id, key: attachments.r2Key, contentType: attachments.contentType })
      .from(attachments)
      .where(and(inArray(attachments.id, ids), eq(attachments.kind, 'signature'))),
  )
  const result = new Map<string, { bytes: Buffer; extension: 'png' | 'jpeg' }>()
  for (const row of rows) {
    const extension =
      row.contentType === 'image/jpeg' ? 'jpeg' : row.contentType === 'image/png' ? 'png' : null
    if (!extension) continue
    const bytes = await getObject({ key: row.key })
    if (bytes.length > 0 && bytes.length <= MAX_TEMPLATE_BYTES) {
      result.set(row.id, { bytes, extension })
    }
  }
  return result
}

async function fillWorkbook(
  ctx: RequestContext,
  bytes: Buffer,
  values: Record<string, unknown>,
): Promise<Buffer> {
  if (bytes.length === 0 || bytes.length > MAX_TEMPLATE_BYTES) {
    throw new Error('Flow XLSX templates must be between 1 byte and 10 MiB.')
  }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const signatures = signatureValues(values)
  const signatureImages = await loadSignatureImages(ctx, signatures)
  const additional = additionalInformation(values)
  let visitedCells = 0

  for (const worksheet of workbook.worksheets) {
    let signatureNameRow: number | null = null
    worksheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value === '{{SIGNATURE-NAME}}' && signatureNameRow === null) {
          signatureNameRow = cell.fullAddress.row
        }
      })
    })
    if (signatureNameRow !== null && signatures.length > 1) {
      worksheet.duplicateRow(signatureNameRow, signatures.length - 1, true)
    }

    worksheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        visitedCells += 1
        if (visitedCells > MAX_WORKBOOK_CELLS) {
          throw new Error(`Flow XLSX templates may contain at most ${MAX_WORKBOOK_CELLS} cells.`)
        }
        if (typeof cell.value !== 'string') return
        const marker = cell.value
        if (marker === '{{SIGNATURE-NAME}}') {
          signatures.forEach((signature, index) => {
            worksheet.getCell(cell.fullAddress.row + index, cell.fullAddress.col).value =
              scalarText(signature.name)
          })
          return
        }
        if (marker === '{{SIGNATURE-COVID}}') {
          signatures.forEach((signature, index) => {
            worksheet.getCell(cell.fullAddress.row + index, cell.fullAddress.col).value =
              scalarText(signature.covid_result ?? 'N/A')
          })
          return
        }
        if (marker === '{{SIGNATURE-VALUE}}') {
          signatures.forEach((signature, index) => {
            const target = worksheet.getCell(cell.fullAddress.row + index, cell.fullAddress.col)
            target.value = ''
            const attachmentId = signature.attachment_id
            if (typeof attachmentId !== 'string') return
            const image = signatureImages.get(attachmentId)
            if (!image) return
            const imageId = workbook.addImage({
              buffer: image.bytes as unknown as NonNullable<ExcelJS.Image['buffer']>,
              extension: image.extension,
            })
            worksheet.addImage(imageId, {
              tl: {
                col: cell.fullAddress.col - 1,
                row: cell.fullAddress.row + index - 1,
              },
              ext: { width: 160, height: 48 },
              editAs: 'oneCell',
            })
          })
          return
        }
        const additionalMatch = /^\{\{AdditionalInformation\['(.+)'\]\}\}$/.exec(marker)
        if (additionalMatch) {
          cell.value = scalarText(additional.get(additionalMatch[1]!) ?? '')
          return
        }
        const fieldMatch = /^\{\{([A-Za-z0-9_.-]+)\}\}$/.exec(marker)
        if (fieldMatch) cell.value = scalarText(values[fieldMatch[1]!] ?? '')
      })
    })
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function renderSpreadsheetAttachments(
  ctx: RequestContext,
  configs: SpreadsheetAttachmentConfig[],
  values: Record<string, unknown>,
): Promise<EmailAttachment[]> {
  if (configs.length === 0) return []
  const ids = [...new Set(configs.map((config) => config.templateAttachmentId))]
  const templates = await ctx.db((tx) =>
    tx
      .select({
        id: attachments.id,
        key: attachments.r2Key,
        filename: attachments.filename,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
      })
      .from(attachments)
      .where(and(inArray(attachments.id, ids), eq(attachments.kind, 'document'))),
  )
  const byId = new Map(templates.map((template) => [template.id, template]))
  const rendered: EmailAttachment[] = []
  for (const config of configs) {
    const template = byId.get(config.templateAttachmentId)
    if (!template || template.contentType !== XLSX_CONTENT_TYPE) {
      throw new Error('A configured Flow XLSX template is missing or is not an XLSX document.')
    }
    if (template.sizeBytes <= 0 || template.sizeBytes > MAX_TEMPLATE_BYTES) {
      throw new Error('Flow XLSX templates must be between 1 byte and 10 MiB.')
    }
    const stored = await getObject({ key: template.key })
    if (stored.length !== template.sizeBytes) {
      throw new Error('A Flow XLSX template changed while it was being read.')
    }
    const output = await fillWorkbook(ctx, stored, values)
    rendered.push({
      filename: safeFilename(config.filename, template.filename),
      content: output.toString('base64'),
      contentType: XLSX_CONTENT_TYPE,
    })
  }
  return rendered
}
