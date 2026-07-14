import { evaluateLogicRule, type EvalContext, type FieldValueMap, type RowMap } from './evaluator'
import { storesResponseValue } from './field-types'
import { isApplicationAttachmentUrl } from './sanitize'
import {
  matrixConfigSchema,
  tableConfigSchema,
  validationPatternError,
  type FormField,
  type FormSchemaV1,
} from './schema'
import { htmlToText } from './text'

export type ValidationError = { fieldId: string; sectionId?: string; message: string }

const MAX_REPEATING_ROWS = 500
const MAX_TABLE_ROWS = 500
const MAX_SELECTIONS = 100
const MAX_ATTACHMENTS = 50
const MAX_PHOTO_MARKERS = 500
const MAX_SHORT_TEXT_LENGTH = 10_000
const MAX_LONG_TEXT_LENGTH = 100_000
const MAX_RICH_TEXT_HTML_LENGTH = 500_000
const MAX_NUMERIC_ABS = 1_000_000_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Validate a response payload against the form schema.
 * Stage = 'draft' relaxes 'required' checks; 'submit' enforces them.
 *
 * The payload shape mirrors what the filler submits: top-level field values
 * keyed by field id, plus each repeating section's rows stored as an array
 * under the SECTION id. Row-level errors use the filler's composite key
 * convention `${sectionId}.${rowIndex}.${fieldId}` so they land on the right
 * row input in the UI.
 */
export function validateResponse(
  schema: FormSchemaV1,
  values: FieldValueMap,
  stage: 'draft' | 'submit' = 'submit',
): ValidationError[] {
  const errors: ValidationError[] = []

  const allowedTopLevelKeys = new Set<string>()
  for (const section of schema.sections) {
    if (section.repeating) allowedTopLevelKeys.add(section.id)
    else {
      for (const field of section.fields) {
        if (storesResponseValue(field)) allowedTopLevelKeys.add(field.id)
      }
    }
  }
  for (const key of Object.keys(values)) {
    if (!allowedTopLevelKeys.has(key)) {
      errors.push({ fieldId: key, message: 'Unknown response field' })
    }
  }

  // Hoist repeating-section rows out of the flat payload so visibility rules
  // evaluate against the same context the filler and PDF renderer use.
  const rows: RowMap = {}
  const invalidRowIndexes: Record<string, Set<number>> = {}
  for (const section of schema.sections) {
    if (!section.repeating) continue
    const raw = values[section.id]
    if (raw === undefined || raw === null) {
      rows[section.id] = []
      continue
    }
    if (!Array.isArray(raw)) {
      errors.push({
        fieldId: section.id,
        sectionId: section.id,
        message: 'Must be a list of rows',
      })
      rows[section.id] = []
      continue
    }
    if (raw.length > MAX_REPEATING_ROWS) {
      errors.push({
        fieldId: section.id,
        sectionId: section.id,
        message: `Use no more than ${MAX_REPEATING_ROWS} rows`,
      })
    }

    const allowedRowKeys = new Set(
      section.fields.filter(storesResponseValue).map((field) => field.id),
    )
    const invalidIndexes = new Set<number>()
    rows[section.id] = raw.slice(0, MAX_REPEATING_ROWS).map((row, rowIndex) => {
      if (!isRecord(row)) {
        invalidIndexes.add(rowIndex)
        errors.push({
          fieldId: `${section.id}.${rowIndex}`,
          sectionId: section.id,
          message: 'Repeating row must be an object',
        })
        return {}
      }
      for (const key of Object.keys(row)) {
        if (!allowedRowKeys.has(key)) {
          errors.push({
            fieldId: `${section.id}.${rowIndex}.${key}`,
            sectionId: section.id,
            message: 'Unknown response field',
          })
        }
      }
      return row
    })
    if (invalidIndexes.size > 0) invalidRowIndexes[section.id] = invalidIndexes
  }
  const ctx: EvalContext = { values, rows }

  for (const section of schema.sections) {
    const sectionVisible = !section.showIf || evaluateLogicRule(section.showIf, ctx)

    if (section.repeating) {
      const sectionRows = rows[section.id] ?? []
      if (
        sectionVisible &&
        stage === 'submit' &&
        section.minRows !== undefined &&
        sectionRows.length < section.minRows
      ) {
        errors.push({
          fieldId: `__section_${section.id}`,
          sectionId: section.id,
          message: `Add at least ${section.minRows} row${section.minRows === 1 ? '' : 's'}`,
        })
      }
      sectionRows.forEach((row, rowIndex) => {
        if (invalidRowIndexes[section.id]?.has(rowIndex)) return
        // Per-row visibility evaluates against the row's own values layered
        // over the top-level values — same as the filler.
        const rowCtx: EvalContext = { ...ctx, values: { ...values, ...row } }
        for (const field of section.fields) {
          if (!storesResponseValue(field)) continue
          const fieldVisible =
            sectionVisible && (!field.showIf || evaluateLogicRule(field.showIf, rowCtx))
          const error = validateFieldValue(field, row[field.id], fieldVisible ? stage : 'draft')
          if (error) {
            errors.push({
              fieldId: `${section.id}.${rowIndex}.${field.id}`,
              sectionId: section.id,
              message: error,
            })
          }
        }
      })
      continue
    }

    for (const field of section.fields) {
      if (!storesResponseValue(field)) continue
      const fieldVisible = sectionVisible && (!field.showIf || evaluateLogicRule(field.showIf, ctx))
      const error = validateFieldValue(field, values[field.id], fieldVisible ? stage : 'draft')
      if (error) errors.push({ fieldId: field.id, sectionId: section.id, message: error })
    }
  }
  return errors
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key))
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= MAX_SHORT_TEXT_LENGTH)
}

const ADDRESS_KEYS = new Set([
  'query',
  'line1',
  'city',
  'region',
  'postal',
  'country',
  'lat',
  'lng',
])
function isAddressValue(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, ADDRESS_KEYS)) return false
  if (
    !['query', 'line1', 'city', 'region', 'postal', 'country'].every((key) =>
      isOptionalString(value[key]),
    )
  ) {
    return false
  }
  const noCoordinates = value.lat === undefined && value.lng === undefined
  if (noCoordinates) return true
  return (
    typeof value.lat === 'number' &&
    Number.isFinite(value.lat) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    typeof value.lng === 'number' &&
    Number.isFinite(value.lng) &&
    value.lng >= -180 &&
    value.lng <= 180
  )
}

function isMatrixValue(field: FormField, value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const config = matrixConfigSchema.safeParse(field.config)
  if (!config.success) return false
  const allowedRows = new Set(config.data.rows.map((row) => row.key))
  const allowedValues = new Set(config.data.scale.map((point) => point.value))
  return Object.entries(value).every(
    ([key, entry]) =>
      allowedRows.has(key) &&
      nonBlankString(entry) &&
      entry.length <= 128 &&
      allowedValues.has(entry),
  )
}

const ATTACHMENT_KEYS = new Set(['attachmentId', 'filename', 'contentType', 'url'])
function isAttachmentValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ATTACHMENT_KEYS) &&
    nonBlankString(value.attachmentId) &&
    nonBlankString(value.filename) &&
    value.filename.length <= 500 &&
    nonBlankString(value.contentType) &&
    value.contentType.length <= 255 &&
    nonBlankString(value.url) &&
    isApplicationAttachmentUrl(value.url, value.attachmentId)
  )
}

function isAttachmentArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MAX_ATTACHMENTS && value.every(isAttachmentValue)
}

const PHOTO_AI_KEYS = new Set(['attachments', 'analysis', 'analyzedAt'])
const PHOTO_ANNOTATED_KEYS = new Set(['attachments', 'markers'])
const SAFETY_VISION_KEYS = new Set(['summary', 'overallRisk', 'ppe', 'hazards'])
const SAFETY_VISION_PPE_KEYS = new Set(['item', 'status', 'detail'])
const SAFETY_VISION_HAZARD_KEYS = new Set(['type', 'severity', 'detail'])
const PHOTO_MARKER_KEYS = new Set(['id', 'x', 'y', 'label'])

function isSafetyVisionAnalysis(value: unknown): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, SAFETY_VISION_KEYS) ||
    typeof value.summary !== 'string' ||
    value.summary.length > 10_000 ||
    !['none', 'low', 'medium', 'high'].includes(String(value.overallRisk)) ||
    !Array.isArray(value.ppe) ||
    value.ppe.length > 12 ||
    !Array.isArray(value.hazards) ||
    value.hazards.length > 12
  ) {
    return false
  }

  const validPpe = value.ppe.every(
    (item) =>
      isRecord(item) &&
      hasOnlyKeys(item, SAFETY_VISION_PPE_KEYS) &&
      typeof item.item === 'string' &&
      item.item.length <= 500 &&
      ['present', 'missing', 'incorrect'].includes(String(item.status)) &&
      (item.detail === null || (typeof item.detail === 'string' && item.detail.length <= 2_000)),
  )
  const validHazards = value.hazards.every(
    (hazard) =>
      isRecord(hazard) &&
      hasOnlyKeys(hazard, SAFETY_VISION_HAZARD_KEYS) &&
      typeof hazard.type === 'string' &&
      hazard.type.length <= 500 &&
      ['low', 'medium', 'high'].includes(String(hazard.severity)) &&
      typeof hazard.detail === 'string' &&
      hazard.detail.length <= 2_000,
  )
  return validPpe && validHazards
}

function isPhotoMarker(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, PHOTO_MARKER_KEYS) &&
    nonBlankString(value.id) &&
    value.id.length <= 128 &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    value.x >= 0 &&
    value.x <= 1 &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    value.y >= 0 &&
    value.y <= 1 &&
    typeof value.label === 'string' &&
    value.label.length <= 2_000
  )
}

function isPhotoCompoundValue(
  type: 'photo_ai' | 'photo_annotated',
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  if (type === 'photo_ai') {
    if (!hasOnlyKeys(value, PHOTO_AI_KEYS)) return false
    if (value.attachments !== undefined && !isAttachmentArray(value.attachments)) return false
    if (value.analysis !== undefined && !isSafetyVisionAnalysis(value.analysis)) return false
    if (value.analyzedAt !== undefined) {
      if (value.analysis === undefined || !nonBlankString(value.analyzedAt)) return false
      if (!isValidDateTime(value.analyzedAt)) return false
    }
    if (
      (value.analysis === undefined) !== (value.analyzedAt === undefined) ||
      (value.analysis !== undefined && (!value.attachments || value.attachments.length === 0))
    ) {
      return false
    }
    return true
  }
  if (!hasOnlyKeys(value, PHOTO_ANNOTATED_KEYS)) return false
  if (value.attachments !== undefined && !isAttachmentArray(value.attachments)) return false
  if (value.markers !== undefined) {
    if (
      !Array.isArray(value.markers) ||
      value.markers.length > MAX_PHOTO_MARKERS ||
      !value.markers.every(isPhotoMarker)
    ) {
      return false
    }
    const markerIds = value.markers.map((marker) => marker.id)
    if (new Set(markerIds).size !== markerIds.length) return false
    if (value.markers.length > 0 && (!value.attachments || value.attachments.length === 0)) {
      return false
    }
  }
  return true
}

const SKETCH_KEYS = new Set(['attachmentId', 'url', 'scene'])
const SKETCH_SCENE_KEYS = new Set(['elements', 'appState', 'files'])
const SKETCH_APP_STATE_KEYS = new Set(['viewBackgroundColor'])
const SKETCH_FILE_KEYS = new Set([
  'mimeType',
  'id',
  'dataURL',
  'created',
  'lastRetrieved',
  'version',
])
const SKETCH_ELEMENT_TYPES = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'line',
  'arrow',
  'freedraw',
  'text',
  'image',
  'frame',
  'magicframe',
])
const SKETCH_RASTER_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/x-icon',
  'image/avif',
  'image/jfif',
])
const MAX_SKETCH_ELEMENTS = 500
const MAX_SKETCH_FILES = 20
const MAX_SKETCH_FILE_DATA_LENGTH = 5_000_000
const MAX_SKETCH_STRING_DATA = 10_000_000
const MAX_SKETCH_JSON_NODES = 100_000

type SketchBudget = { nodes: number; stringLength: number }

function isBoundedSketchJson(value: unknown, budget: SketchBudget, depth = 0): boolean {
  budget.nodes += 1
  if (budget.nodes > MAX_SKETCH_JSON_NODES || depth > 20) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') {
    budget.stringLength += value.length
    return budget.stringLength <= MAX_SKETCH_STRING_DATA
  }
  if (Array.isArray(value)) {
    return (
      value.length <= 10_000 &&
      value.every((entry) => isBoundedSketchJson(entry, budget, depth + 1))
    )
  }
  if (!isRecord(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length <= 200 &&
    entries.every(
      ([key, entry]) => key.length <= 128 && isBoundedSketchJson(entry, budget, depth + 1),
    )
  )
}

function isSketchElement(value: unknown, budget: SketchBudget): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    !nonBlankString(value.id) ||
    value.id.length > 128 ||
    typeof value.type !== 'string' ||
    !SKETCH_ELEMENT_TYPES.has(value.type)
  ) {
    return false
  }
  for (const key of ['x', 'y', 'width', 'height', 'angle'] as const) {
    const coordinate = value[key]
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) return false
    if (Math.abs(coordinate) > 10_000_000) return false
  }
  if ((value.width as number) < 0 || (value.height as number) < 0) return false
  if (value.isDeleted !== undefined && typeof value.isDeleted !== 'boolean') return false
  return isBoundedSketchJson(value, budget)
}

function isSketchFile(value: unknown, key: string, budget: SketchBudget): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, SKETCH_FILE_KEYS)) return false
  if (value.id !== key || !nonBlankString(value.id) || value.id.length > 128) return false
  if (typeof value.mimeType !== 'string' || !SKETCH_RASTER_MIME_TYPES.has(value.mimeType)) {
    return false
  }
  if (
    typeof value.dataURL !== 'string' ||
    value.dataURL.length > MAX_SKETCH_FILE_DATA_LENGTH ||
    !value.dataURL.startsWith(`data:${value.mimeType};base64,`) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.dataURL.slice(value.dataURL.indexOf(',') + 1))
  ) {
    return false
  }
  for (const timestamp of [value.created, value.lastRetrieved]) {
    if (
      timestamp !== undefined &&
      (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0)
    ) {
      return false
    }
  }
  if (
    value.version !== undefined &&
    (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 0)
  ) {
    return false
  }
  return isBoundedSketchJson(value, budget)
}

function isSketchScene(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, SKETCH_SCENE_KEYS)) return false
  if (!Array.isArray(value.elements) || value.elements.length > MAX_SKETCH_ELEMENTS) return false
  if (
    !isRecord(value.appState) ||
    !hasOnlyKeys(value.appState, SKETCH_APP_STATE_KEYS) ||
    (value.appState.viewBackgroundColor !== undefined &&
      (typeof value.appState.viewBackgroundColor !== 'string' ||
        value.appState.viewBackgroundColor.length > 100))
  ) {
    return false
  }
  if (!isRecord(value.files)) return false
  const files = Object.entries(value.files)
  if (files.length > MAX_SKETCH_FILES) return false

  const budget: SketchBudget = { nodes: 0, stringLength: 0 }
  const elementIds = value.elements.map((element) =>
    isRecord(element) && typeof element.id === 'string' ? element.id : null,
  )
  return (
    value.elements.every((element) => isSketchElement(element, budget)) &&
    elementIds.every((id): id is string => id !== null) &&
    new Set(elementIds).size === elementIds.length &&
    files.every(([key, file]) => key.length <= 128 && isSketchFile(file, key, budget))
  )
}

function isSketchValue(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, SKETCH_KEYS)) return false
  const empty = value.attachmentId === undefined && value.url === undefined
  if (empty) return value.scene === undefined
  return (
    nonBlankString(value.attachmentId) &&
    nonBlankString(value.url) &&
    isApplicationAttachmentUrl(value.url, value.attachmentId) &&
    (value.scene === undefined || isSketchScene(value.scene))
  )
}

const YES_NO_COMMENT_KEYS = new Set(['answer', 'comment'])
function isYesNoCommentValue(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, YES_NO_COMMENT_KEYS) &&
    (value.answer === undefined || ['yes', 'no', 'na'].includes(String(value.answer))) &&
    isOptionalString(value.comment)
  )
}

const GPS_KEYS = new Set(['lat', 'lng', 'accuracy', 'capturedAt'])
function isGpsValue(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, GPS_KEYS)) return false
  const noCoordinates = value.lat === undefined && value.lng === undefined
  if (noCoordinates) return value.accuracy === undefined && value.capturedAt === undefined
  return (
    typeof value.lat === 'number' &&
    Number.isFinite(value.lat) &&
    typeof value.lng === 'number' &&
    Number.isFinite(value.lng) &&
    (value.accuracy === undefined ||
      (typeof value.accuracy === 'number' &&
        Number.isFinite(value.accuracy) &&
        value.accuracy >= 0)) &&
    (value.capturedAt === undefined ||
      (nonBlankString(value.capturedAt) && isValidDateTime(value.capturedAt)))
  )
}

const SIGNATURE_KEYS = new Set(['attachmentId', 'url'])
function isSignatureValue(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, SIGNATURE_KEYS)) return false
  if (value.attachmentId === undefined && value.url === undefined) return true
  return (
    nonBlankString(value.attachmentId) &&
    nonBlankString(value.url) &&
    isApplicationAttachmentUrl(value.url, value.attachmentId)
  )
}

const ATTESTATION_KEYS = new Set(['name', 'agreed'])
function isAttestationValue(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ATTESTATION_KEYS) &&
    isOptionalString(value.name) &&
    (value.agreed === undefined || typeof value.agreed === 'boolean')
  )
}

const RISK_MATRIX_KEYS = new Set(['severity', 'likelihood', 'score', 'label'])
function isRiskMatrixValue(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, RISK_MATRIX_KEYS)) return false
  const empty = value.severity === undefined && value.likelihood === undefined
  if (empty) return value.score === undefined && value.label === undefined
  return (
    typeof value.severity === 'number' &&
    Number.isInteger(value.severity) &&
    value.severity >= 1 &&
    value.severity <= 6 &&
    typeof value.likelihood === 'number' &&
    Number.isInteger(value.likelihood) &&
    value.likelihood >= 1 &&
    value.likelihood <= 6 &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    value.score === value.severity * value.likelihood &&
    typeof value.label === 'string' &&
    value.label.length <= 500
  )
}

function isNonBlankStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_SELECTIONS &&
    value.every((entry) => nonBlankString(entry) && entry.length <= 500)
  )
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isValidTimeParts(hour: string, minute: string, second?: string): boolean {
  return (
    Number(hour) <= 23 && Number(minute) <= 59 && (second === undefined || Number(second) <= 59)
  )
}

function isValidTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/.exec(value)
  return !!match && isValidTimeParts(match[1]!, match[2]!, match[3])
}

function isValidDateTime(value: string): boolean {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    )
  return !!match && isValidDate(match[1]!) && isValidTimeParts(match[2]!, match[3]!, match[4])
}

type TableValueColumn = {
  key: string
  type: 'text' | 'number' | 'select' | 'checkbox' | 'date'
  options?: Array<{ value: string }>
}

function tableValueColumns(field: FormField): TableValueColumn[] | null {
  const parsed = tableConfigSchema.safeParse(field.config)
  if (!parsed.success) return null
  return parsed.data.columns
}

function isValidTableValue(field: FormField, value: unknown[]): boolean {
  const config = tableConfigSchema.safeParse(field.config)
  if (!config.success) return false
  if (value.length > MAX_TABLE_ROWS) return false
  if (
    config.data.rowMode === 'fixed' &&
    value.length > 0 &&
    value.length !== (config.data.rows?.length ?? 0)
  ) {
    return false
  }
  const columns = tableValueColumns(field)
  if (!columns) return false
  const byKey = new Map(columns.map((column) => [column.key, column]))

  return value.every((row) => {
    if (!isRecord(row) || Object.keys(row).some((key) => !byKey.has(key))) return false
    return Object.entries(row).every(([key, cell]) => {
      if (cell === undefined || cell === null) return true
      const column = byKey.get(key)!
      switch (column.type) {
        case 'number':
          return (
            typeof cell === 'number' && Number.isFinite(cell) && Math.abs(cell) <= MAX_NUMERIC_ABS
          )
        case 'checkbox':
          return typeof cell === 'boolean'
        case 'date':
          return typeof cell === 'string' && cell.length <= 50 && (cell === '' || isValidDate(cell))
        case 'select':
          return (
            typeof cell === 'string' &&
            cell.length <= 500 &&
            (cell === '' ||
              !column.options?.length ||
              column.options.some((option) => option.value === cell))
          )
        default:
          return typeof cell === 'string' && cell.length <= MAX_SHORT_TEXT_LENGTH
      }
    })
  })
}

function isStepAligned(value: number, base: number, step: number): boolean {
  const quotient = (value - base) / step
  const nearest = Math.round(quotient)
  return Math.abs(quotient - nearest) <= Number.EPSILON * Math.max(16, Math.abs(quotient) * 16)
}

function hasMeaningfulMatrixValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).some(
      (entry) => entry !== undefined && entry !== null && String(entry).trim().length > 0,
    )
  )
}

function isFieldValueEmpty(field: FormField, value: unknown): boolean {
  if (value === undefined || value === null) return true

  switch (field.type) {
    case 'multi_select':
    case 'checkbox_group':
    case 'ranking':
    case 'multi_person_picker':
    case 'data_table':
    case 'photo':
    case 'photo_upload':
    case 'file':
    case 'video':
    case 'audio':
    case 'table':
      return Array.isArray(value) && value.length === 0
    case 'rich_text':
      // Images do not carry a response value and sanitized rich text does not
      // permit them, so image-only markup is intentionally visually empty.
      return typeof value === 'string' && htmlToText(value).length === 0
    case 'address':
      return isAddressValue(value) && !nonBlankString(value.line1) && !nonBlankString(value.query)
    case 'matrix':
      return isMatrixValue(field, value) && !hasMeaningfulMatrixValue(value)
    case 'photo_ai':
    case 'photo_annotated':
      return (
        isPhotoCompoundValue(field.type, value) &&
        (!Array.isArray(value.attachments) || value.attachments.length === 0)
      )
    case 'sketch':
      return isSketchValue(value) && !nonBlankString(value.attachmentId)
    case 'yes_no_comment':
      return isYesNoCommentValue(value) && !nonBlankString(value.answer)
    case 'gps':
      return isGpsValue(value) && value.lat === undefined && value.lng === undefined
    case 'signature':
      return (
        isSignatureValue(value) && !nonBlankString(value.attachmentId) && !nonBlankString(value.url)
      )
    case 'typed_attestation':
      return isAttestationValue(value) && !nonBlankString(value.name) && value.agreed !== true
    case 'risk_matrix':
      return (
        isRiskMatrixValue(value) &&
        !nonBlankString(value.severity) &&
        !nonBlankString(value.likelihood) &&
        typeof value.score !== 'number'
      )
    default:
      return value === ''
  }
}

function requiredMessage(field: FormField): string {
  if (field.validation?.message) return field.validation.message
  switch (field.type) {
    case 'matrix':
      return 'Rate at least one row'
    case 'photo_ai':
    case 'photo_annotated':
      return 'Add a photo'
    case 'sketch':
      return 'Add a diagram'
    default:
      return 'Required'
  }
}

/**
 * Validate one field value. This is the shared browser/server boundary; callers
 * that validate drafts should pass `draft` to relax completion requirements
 * while still rejecting malformed values.
 */
export function validateFieldValue(
  field: FormField,
  value: unknown,
  stage: 'draft' | 'submit' = 'submit',
): string | null {
  if (!storesResponseValue(field)) return null

  const v = field.validation
  // Effective `required` is the union of `field.required` and the optional
  const required = field.required || v?.required
  const isEmpty = isFieldValueEmpty(field, value)
  if (required && stage === 'submit' && isEmpty) return requiredMessage(field)
  if (isEmpty) {
    const tableMinRows =
      field.type === 'table' && typeof field.config?.minRows === 'number' ? field.config.minRows : 0
    if (stage === 'submit' && tableMinRows > 0) {
      return v?.message ?? `Add at least ${tableMinRows} row${tableMinRows === 1 ? '' : 's'}`
    }
    return null
  }

  switch (field.type) {
    case 'number':
    case 'rating':
    case 'slider': {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return v?.message ?? 'Must be a number'
      const n = value
      if (Math.abs(n) > MAX_NUMERIC_ABS) {
        return v?.message ?? `Must be between -${MAX_NUMERIC_ABS} and ${MAX_NUMERIC_ABS}`
      }
      if (field.type === 'rating') {
        const configuredMax = field.config?.max
        const scaleMax =
          typeof configuredMax === 'number' &&
          Number.isInteger(configuredMax) &&
          configuredMax >= 1 &&
          configuredMax <= 10
            ? configuredMax
            : 5
        const validationMin =
          typeof v?.min === 'number' && Number.isFinite(v.min) ? v.min : undefined
        const validationMax =
          typeof v?.max === 'number' && Number.isFinite(v.max) ? v.max : undefined
        const min = Math.max(1, validationMin ?? 1)
        const max = Math.min(scaleMax, validationMax ?? scaleMax)
        if (!Number.isInteger(n) || n < min || n > max) {
          return v?.message ?? `Must be a whole-number rating from ${min} to ${max}`
        }
        return null
      }

      const numericConfig = field.config
      const configuredMin =
        typeof numericConfig?.min === 'number' && Number.isFinite(numericConfig.min)
          ? numericConfig.min
          : field.type === 'slider'
            ? 0
            : undefined
      const configuredMax =
        typeof numericConfig?.max === 'number' && Number.isFinite(numericConfig.max)
          ? numericConfig.max
          : field.type === 'slider'
            ? 10
            : undefined
      const validationMin = typeof v?.min === 'number' && Number.isFinite(v.min) ? v.min : undefined
      const validationMax = typeof v?.max === 'number' && Number.isFinite(v.max) ? v.max : undefined
      const min =
        configuredMin === undefined
          ? validationMin
          : validationMin === undefined
            ? configuredMin
            : Math.max(configuredMin, validationMin)
      const max =
        configuredMax === undefined
          ? validationMax
          : validationMax === undefined
            ? configuredMax
            : Math.min(configuredMax, validationMax)
      if (min !== undefined && n < min) return v?.message ?? `Must be >= ${min}`
      if (max !== undefined && n > max) return v?.message ?? `Must be <= ${max}`
      const configuredStep = numericConfig?.step
      const step =
        typeof configuredStep === 'number' && Number.isFinite(configuredStep) && configuredStep > 0
          ? configuredStep
          : field.type === 'slider'
            ? 1
            : undefined
      if (step !== undefined) {
        const base = configuredMin ?? 0
        if (!isStepAligned(n, base, step)) {
          return v?.message ?? `Must use increments of ${step}`
        }
      }
      return null
    }
    case 'rich_text': {
      if (typeof value !== 'string') return v?.message ?? 'Must be text'
      if (value.length > MAX_RICH_TEXT_HTML_LENGTH) return v?.message ?? 'Text is too long'
      const text = htmlToText(value)
      if (text.length > MAX_LONG_TEXT_LENGTH) return v?.message ?? 'Text is too long'
      if (v?.minLength !== undefined && text.length < v.minLength)
        return v?.message ?? `Min ${v.minLength} chars`
      if (v?.maxLength !== undefined && text.length > v.maxLength)
        return v?.message ?? `Max ${v.maxLength} chars`
      return validateTextPattern(field, text)
    }
    case 'text':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'url':
    case 'date':
    case 'datetime':
    case 'time':
    case 'qr_scanner': {
      if (typeof value !== 'string') return v?.message ?? 'Must be text'
      const hardLimit =
        field.type === 'long_text'
          ? MAX_LONG_TEXT_LENGTH
          : field.type === 'email'
            ? 320
            : field.type === 'url'
              ? 2_048
              : field.type === 'phone'
                ? 100
                : ['date', 'datetime', 'time'].includes(field.type)
                  ? 50
                  : MAX_SHORT_TEXT_LENGTH
      if (value.length > hardLimit) return v?.message ?? 'Text is too long'
      if (v?.minLength !== undefined && value.length < v.minLength)
        return v?.message ?? `Min ${v.minLength} chars`
      if (v?.maxLength !== undefined && value.length > v.maxLength)
        return v?.message ?? `Max ${v.maxLength} chars`
      const patternError = validateTextPattern(field, value)
      if (patternError) return patternError
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        return v?.message ?? 'Invalid email'
      if (field.type === 'url' && !/^https?:\/\/.+/.test(value)) return v?.message ?? 'Invalid URL'
      if (field.type === 'date' && !isValidDate(value)) return v?.message ?? 'Invalid date'
      if (field.type === 'datetime' && !isValidDateTime(value))
        return v?.message ?? 'Invalid date and time'
      if (field.type === 'time' && !isValidTime(value)) return v?.message ?? 'Invalid time'
      return null
    }
    case 'select':
    case 'radio': {
      if (typeof value !== 'string' || value.length > 500) return v?.message ?? 'Must be a choice'
      if (v?.options && !v.options.some((o) => o.value === value) && !v.allowOther) {
        return v?.message ?? 'Not a valid choice'
      }
      return null
    }
    case 'multi_select':
    case 'checkbox_group': {
      if (!isNonBlankStringArray(value)) return v?.message ?? 'Must be a list of choices'
      if (new Set(value).size !== value.length) return v?.message ?? 'Choices must be unique'
      if (
        v?.options &&
        !v.allowOther &&
        value.some((entry) => !v.options!.some((option) => option.value === entry))
      ) {
        return v.message ?? 'Not a valid choice'
      }
      return null
    }
    case 'ranking': {
      if (!isNonBlankStringArray(value)) return v?.message ?? 'Must be a list of choices'
      if (new Set(value).size !== value.length) return v?.message ?? 'Choices must be unique'
      if (
        v?.options &&
        value.some((entry) => !v.options!.some((option) => option.value === entry))
      ) {
        return v.message ?? 'Not a valid choice'
      }
      return null
    }
    case 'data_table': {
      if (!isNonBlankStringArray(value)) return v?.message ?? 'Must be a list of selections'
      if (new Set(value).size !== value.length) return v?.message ?? 'Selections must be unique'
      return null
    }
    case 'multi_person_picker': {
      if (!Array.isArray(value) || value.length > MAX_SELECTIONS || !value.every(isUuid)) {
        return v?.message ?? 'Must be a list of people'
      }
      if (new Set(value).size !== value.length) return v?.message ?? 'Selections must be unique'
      return null
    }
    case 'photo':
    case 'photo_upload':
    case 'file':
    case 'video':
    case 'audio': {
      if (!isAttachmentArray(value)) return v?.message ?? 'Invalid attachment list'
      return null
    }
    case 'table': {
      if (!Array.isArray(value)) return v?.message ?? 'Must be a table'
      if (value.length > MAX_TABLE_ROWS)
        return v?.message ?? `Use no more than ${MAX_TABLE_ROWS} rows`
      if (!isValidTableValue(field, value)) return v?.message ?? 'Invalid table row or cell value'
      const minRows = typeof field.config?.minRows === 'number' ? field.config.minRows : undefined
      const maxRows = typeof field.config?.maxRows === 'number' ? field.config.maxRows : undefined
      if (stage === 'submit' && minRows !== undefined && value.length < minRows) {
        return v?.message ?? `Add at least ${minRows} row${minRows === 1 ? '' : 's'}`
      }
      if (maxRows !== undefined && value.length > maxRows) {
        return v?.message ?? `Use no more than ${maxRows} row${maxRows === 1 ? '' : 's'}`
      }
      return null
    }
    case 'address':
      return isAddressValue(value) ? null : (v?.message ?? 'Must be an address')
    case 'matrix':
      return isMatrixValue(field, value) ? null : (v?.message ?? 'Must be a rating grid')
    case 'photo_ai':
    case 'photo_annotated':
      return isPhotoCompoundValue(field.type, value) && Array.isArray(value.attachments)
        ? null
        : (v?.message ?? 'Invalid photo value')
    case 'sketch':
      return isSketchValue(value) && nonBlankString(value.attachmentId)
        ? null
        : (v?.message ?? 'Invalid diagram')
    case 'gps': {
      if (!isGpsValue(value)) return v?.message ?? 'Invalid location'
      const lat = value.lat
      const lng = value.lng
      if (
        typeof lat !== 'number' ||
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        typeof lng !== 'number' ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180
      ) {
        return v?.message ?? 'Invalid location'
      }
      return null
    }
    case 'signature':
      return isSignatureValue(value) && nonBlankString(value.attachmentId)
        ? null
        : (v?.message ?? 'Invalid signature')
    case 'yes_no_comment': {
      if (!isYesNoCommentValue(value) || !nonBlankString(value.answer)) {
        return v?.message ?? 'Choose Yes or No'
      }
      if (stage === 'submit' && value.answer === 'no' && !nonBlankString(value.comment)) {
        return v?.message ?? 'Add a comment'
      }
      return null
    }
    case 'typed_attestation': {
      if (!isAttestationValue(value)) return v?.message ?? 'Invalid attestation'
      if (typeof value.name === 'string' && value.name.length > 500) {
        return v?.message ?? 'Name is too long'
      }
      if (stage === 'draft') return null
      if (!nonBlankString(value.name)) return v?.message ?? 'Type your full name'
      if (value.agreed !== true) return v?.message ?? 'Confirm the attestation'
      return null
    }
    case 'risk_matrix': {
      if (!isRiskMatrixValue(value)) return v?.message ?? 'Invalid risk rating'
      if (stage === 'draft') return null
      if (typeof value.severity !== 'number' || typeof value.likelihood !== 'number') {
        return v?.message ?? 'Complete the risk rating'
      }
      return null
    }
    case 'pass_fail_na':
      return typeof value === 'string' && ['pass', 'fail', 'n_a'].includes(value)
        ? null
        : (v?.message ?? 'Choose Pass, Fail, or N/A')
    case 'traffic_light':
      return typeof value === 'string' && ['green', 'yellow', 'red'].includes(value)
        ? null
        : (v?.message ?? 'Choose Green, Yellow, or Red')
    case 'person_picker':
    case 'customer_picker':
    case 'project_picker':
    case 'site_picker':
    case 'area_picker':
      return isUuid(value) ? null : (v?.message ?? 'Must be a selection')
    case 'lookup':
      return nonBlankString(value) && value.length <= 500
        ? null
        : (v?.message ?? 'Must be a selection')
    case 'formula':
    case 'heading':
    case 'paragraph':
    case 'divider':
    case 'metric':
      return null
    default: {
      const unhandledType: never = field.type
      return unhandledType
    }
  }
}

function validateTextPattern(field: FormField, value: string): string | null {
  const pattern = field.validation?.pattern
  if (!pattern) return null

  // Historical/imported schemas may bypass canonical parsing. Fail closed
  // without ever executing an unsafe expression at the submission boundary.
  if (validationPatternError(pattern)) return field.validation?.message ?? 'Invalid format'
  return new RegExp(pattern).test(value) ? null : (field.validation?.message ?? 'Invalid format')
}
