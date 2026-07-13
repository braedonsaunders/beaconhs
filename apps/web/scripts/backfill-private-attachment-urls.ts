/**
 * Clean-cutover migration for persisted attachment references.
 *
 * Audit mode fully resolves every reference without writing. Apply mode repeats
 * that preflight under a dedicated session advisory lock, then atomically
 * rewrites every affected row to the current authenticated attachment route.
 */

import { createClient } from '@beaconhs/db'
import { attachmentUrl } from '../src/lib/attachment-url'
import {
  inspectPersistedValue,
  rewritePersistedValue,
  type AttachmentReference,
  type PersistedJson,
} from './private-attachment-url-cutover'
import {
  assertCutoverDatabaseSession,
  assertCutoverObjectPrivate,
  requireCutoverCapabilitySecret,
  requireCutoverDatabaseTarget,
  requireCutoverStorageTarget,
} from './cutover-target'

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = requireCutoverDatabaseTarget(APPLY)
const STORAGE_TARGET = requireCutoverStorageTarget()
requireCutoverCapabilitySecret()

// The package captures its endpoint and credentials during module evaluation,
// so it must not load until all audited target checks above have succeeded.
const storage = await import('@beaconhs/storage')
if (storage.BUCKET !== STORAGE_TARGET.bucket) {
  throw new Error('Storage package bucket does not match the audited cutover target')
}

const LOCK_NAME = 'beaconhs:private-attachment-url-cutover:v1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const { sql } = createClient({ url: DATABASE_URL, max: 2 })
const { sql: lockSql } = createClient({ url: DATABASE_URL, max: 1 })

type AttachmentRow = {
  id: string
  tenant_id: string
  r2_key: string
  content_type: string
  size_bytes: string
}

type NullableJson = {
  value: PersistedJson
  sqlNull: boolean
}

type TrainingRow = {
  id: string
  tenant_id: string
  content_html: string | null
  content_json: PersistedJson
  content_json_sql_null: boolean
  slides: PersistedJson
}

type FormResponseRow = {
  id: string
  tenant_id: string
  data: PersistedJson
  draft_data: PersistedJson
  draft_data_sql_null: boolean
  workflow_state: PersistedJson
  workflow_state_sql_null: boolean
}

type TrainingSnapshot = {
  contentHtml: string | null
  contentJson: NullableJson
  slides: PersistedJson
}

type FormResponseSnapshot = {
  data: PersistedJson
  draftData: NullableJson
  workflowState: NullableJson
}

type RowPlan =
  | {
      table: 'training_lessons' | 'training_content_items'
      id: string
      tenantId: string
      before: TrainingSnapshot
      after: TrainingSnapshot
    }
  | {
      table: 'form_responses'
      id: string
      tenantId: string
      before: FormResponseSnapshot
      after: FormResponseSnapshot
    }

type PreparedCutover = {
  plans: RowPlan[]
  stats: {
    rowsScanned: number
    references: number
    routes: number
    public: number
    pending: number
    invalid: number
    changedRows: number
  }
}

function canonicalJson(value: PersistedJson): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Persisted JSON contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(',')}}`
}

function jsonEqual(left: PersistedJson, right: PersistedJson): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function nullableJsonEqual(left: NullableJson, right: NullableJson): boolean {
  return left.sqlNull === right.sqlNull && jsonEqual(left.value, right.value)
}

function trainingEqual(left: TrainingSnapshot, right: TrainingSnapshot): boolean {
  return (
    left.contentHtml === right.contentHtml &&
    nullableJsonEqual(left.contentJson, right.contentJson) &&
    jsonEqual(left.slides, right.slides)
  )
}

function formResponseEqual(left: FormResponseSnapshot, right: FormResponseSnapshot): boolean {
  return (
    jsonEqual(left.data, right.data) &&
    nullableJsonEqual(left.draftData, right.draftData) &&
    nullableJsonEqual(left.workflowState, right.workflowState)
  )
}

function normalizedContentType(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase()
}

function attachmentSize(row: AttachmentRow): number {
  const value = Number(row.size_bytes)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Attachment ${row.id} has invalid size_bytes`)
  }
  return value
}

function validateAttachmentRow(row: AttachmentRow): void {
  if (!UUID_RE.test(row.id) || !UUID_RE.test(row.tenant_id)) {
    throw new Error('Attachment lookup returned a non-UUID identifier')
  }
  if (!row.r2_key || row.r2_key.startsWith('/') || row.r2_key.split('/').includes('..')) {
    throw new Error(`Attachment ${row.id} has an unsafe object key`)
  }
  if (!normalizedContentType(row.content_type)) {
    throw new Error(`Attachment ${row.id} has an empty content type`)
  }
  attachmentSize(row)
}

async function assertAttachmentObject(row: AttachmentRow): Promise<void> {
  const metadata = await storage.headObject({ key: row.r2_key })
  if (!metadata) throw new Error(`Attachment ${row.id} object is missing`)
  if (
    metadata.contentLength !== attachmentSize(row) ||
    normalizedContentType(metadata.contentType ?? '') !== normalizedContentType(row.content_type)
  ) {
    throw new Error(`Attachment ${row.id} object metadata does not match the database`)
  }
}

function referenceKey(reference: AttachmentReference): string {
  return `${reference.kind}\0${reference.raw}`
}

async function loadReferencedAttachments(
  ids: readonly string[],
  keys: readonly string[],
): Promise<AttachmentRow[]> {
  if (ids.length === 0 && keys.length === 0) return []
  if (ids.length > 0 && keys.length > 0) {
    return sql<AttachmentRow[]>`
      select id::text, tenant_id::text, r2_key, content_type, size_bytes::text
      from attachments
      where id = any(${ids}::uuid[]) or r2_key = any(${keys}::text[])
      order by id
    `
  }
  if (ids.length > 0) {
    return sql<AttachmentRow[]>`
      select id::text, tenant_id::text, r2_key, content_type, size_bytes::text
      from attachments where id = any(${ids}::uuid[]) order by id
    `
  }
  return sql<AttachmentRow[]>`
    select id::text, tenant_id::text, r2_key, content_type, size_bytes::text
    from attachments where r2_key = any(${keys}::text[]) order by id
  `
}

async function loadRows(): Promise<{
  lessons: TrainingRow[]
  items: TrainingRow[]
  responses: FormResponseRow[]
}> {
  const [lessons, items, responses] = await Promise.all([
    sql<TrainingRow[]>`
      select id::text, tenant_id::text, content_html, content_json,
             content_json is null as content_json_sql_null, slides
      from training_lessons order by id
    `,
    sql<TrainingRow[]>`
      select id::text, tenant_id::text, content_html, content_json,
             content_json is null as content_json_sql_null, slides
      from training_content_items order by id
    `,
    sql<FormResponseRow[]>`
      select id::text, tenant_id::text, data, draft_data,
             draft_data is null as draft_data_sql_null, workflow_state,
             workflow_state is null as workflow_state_sql_null
      from form_responses order by id
    `,
  ])
  return { lessons, items, responses }
}

type InspectedRow = {
  table: RowPlan['table']
  id: string
  tenantId: string
  before: TrainingSnapshot | FormResponseSnapshot
  references: AttachmentReference[]
}

function inspectCell(
  value: PersistedJson,
  tenantId: string,
  path: string,
): ReturnType<typeof inspectPersistedValue> {
  return inspectPersistedValue(value, tenantId, path)
}

function inspectTrainingRow(
  table: 'training_lessons' | 'training_content_items',
  row: TrainingRow,
): { row: InspectedRow; invalid: ReturnType<typeof inspectPersistedValue>['invalid'] } {
  const path = `${table}.${row.id}`
  const cells = [
    inspectCell(row.content_html, row.tenant_id, `${path}.content_html`),
    inspectCell(row.content_json, row.tenant_id, `${path}.content_json`),
    inspectCell(row.slides, row.tenant_id, `${path}.slides`),
  ]
  return {
    row: {
      table,
      id: row.id,
      tenantId: row.tenant_id,
      before: {
        contentHtml: row.content_html,
        contentJson: { value: row.content_json, sqlNull: row.content_json_sql_null },
        slides: row.slides,
      },
      references: cells.flatMap((cell) => cell.references),
    },
    invalid: cells.flatMap((cell) => cell.invalid),
  }
}

function inspectFormResponseRow(row: FormResponseRow): {
  row: InspectedRow
  invalid: ReturnType<typeof inspectPersistedValue>['invalid']
} {
  const path = `form_responses.${row.id}`
  const cells = [
    inspectCell(row.data, row.tenant_id, `${path}.data`),
    inspectCell(row.draft_data, row.tenant_id, `${path}.draft_data`),
    inspectCell(row.workflow_state, row.tenant_id, `${path}.workflow_state`),
  ]
  return {
    row: {
      table: 'form_responses',
      id: row.id,
      tenantId: row.tenant_id,
      before: {
        data: row.data,
        draftData: { value: row.draft_data, sqlNull: row.draft_data_sql_null },
        workflowState: { value: row.workflow_state, sqlNull: row.workflow_state_sql_null },
      },
      references: cells.flatMap((cell) => cell.references),
    },
    invalid: cells.flatMap((cell) => cell.invalid),
  }
}

function replacementFor(
  reference: AttachmentReference,
  tenantId: string,
  attachmentsById: ReadonlyMap<string, AttachmentRow>,
  attachmentsByKey: ReadonlyMap<string, AttachmentRow>,
): { value: string; attachment: AttachmentRow } {
  const attachment =
    reference.kind === 'route'
      ? attachmentsById.get(reference.attachmentId)
      : attachmentsByKey.get(reference.key)
  if (!attachment) {
    throw new Error(`No attachment matches ${reference.path}`)
  }
  if (attachment.tenant_id.toLowerCase() !== tenantId.toLowerCase()) {
    throw new Error(`Attachment reference crosses tenants at ${reference.path}`)
  }
  if (reference.kind === 'public-object' && attachment.r2_key !== reference.key) {
    throw new Error(`Public object key does not exactly match its attachment at ${reference.path}`)
  }

  const value = attachmentUrl(attachment.id)
  return { value, attachment }
}

function rewriteInspectedRow(
  row: InspectedRow,
  replacements: ReadonlyMap<string, string>,
): RowPlan {
  const replace = (reference: AttachmentReference) => {
    const value = replacements.get(referenceKey(reference))
    if (!value) throw new Error(`Missing preflight replacement for ${reference.path}`)
    return value
  }
  if (row.table === 'form_responses') {
    const before = row.before as FormResponseSnapshot
    return {
      table: row.table,
      id: row.id,
      tenantId: row.tenantId,
      before,
      after: {
        data: rewritePersistedValue(
          before.data,
          row.tenantId,
          replace,
          `form_responses.${row.id}.data`,
        ),
        draftData: {
          value: rewritePersistedValue(
            before.draftData.value,
            row.tenantId,
            replace,
            `form_responses.${row.id}.draft_data`,
          ),
          sqlNull: before.draftData.sqlNull,
        },
        workflowState: {
          value: rewritePersistedValue(
            before.workflowState.value,
            row.tenantId,
            replace,
            `form_responses.${row.id}.workflow_state`,
          ),
          sqlNull: before.workflowState.sqlNull,
        },
      },
    }
  }
  const before = row.before as TrainingSnapshot
  const contentHtml = rewritePersistedValue(
    before.contentHtml,
    row.tenantId,
    replace,
    `${row.table}.${row.id}.content_html`,
  )
  if (contentHtml !== null && typeof contentHtml !== 'string') {
    throw new Error(`${row.table}.${row.id}.content_html changed type during preflight`)
  }
  return {
    table: row.table,
    id: row.id,
    tenantId: row.tenantId,
    before,
    after: {
      contentHtml,
      contentJson: {
        value: rewritePersistedValue(
          before.contentJson.value,
          row.tenantId,
          replace,
          `${row.table}.${row.id}.content_json`,
        ),
        sqlNull: before.contentJson.sqlNull,
      },
      slides: rewritePersistedValue(
        before.slides,
        row.tenantId,
        replace,
        `${row.table}.${row.id}.slides`,
      ),
    },
  }
}

async function assertStoragePrivacy(known?: AttachmentRow): Promise<void> {
  let attachment = known
  if (!attachment) {
    const [sample] = await sql<AttachmentRow[]>`
      select id::text, tenant_id::text, r2_key, content_type, size_bytes::text
      from attachments order by id limit 1
    `
    attachment = sample
  }
  if (!attachment) {
    throw new Error('Cannot prove object-store privacy because no known attachment exists')
  }
  validateAttachmentRow(attachment)
  await assertAttachmentObject(attachment)
  await assertCutoverObjectPrivate(attachment.r2_key, STORAGE_TARGET)
}

async function prepareCutover(): Promise<PreparedCutover> {
  const loaded = await loadRows()
  const inspected = [
    ...loaded.lessons.map((row) => inspectTrainingRow('training_lessons', row)),
    ...loaded.items.map((row) => inspectTrainingRow('training_content_items', row)),
    ...loaded.responses.map(inspectFormResponseRow),
  ]
  const invalid = inspected.flatMap((item) => item.invalid)
  if (invalid.length > 0) {
    const examples = invalid
      .slice(0, 5)
      .map((item) => `${item.path}: ${item.reason}`)
      .join('; ')
    throw new Error(`Found ${invalid.length} invalid attachment reference(s): ${examples}`)
  }

  const rows = inspected.map((item) => item.row)
  const references = rows.flatMap((row) => row.references)
  const ids = [
    ...new Set(
      references
        .filter((reference) => reference.kind === 'route')
        .map((reference) => reference.attachmentId),
    ),
  ]
  const keys = [
    ...new Set(
      references
        .filter((reference) => reference.kind === 'public-object')
        .map((reference) => reference.key),
    ),
  ]
  const attachmentRows = await loadReferencedAttachments(ids, keys)
  attachmentRows.forEach(validateAttachmentRow)
  const attachmentsById = new Map(attachmentRows.map((row) => [row.id.toLowerCase(), row]))
  const attachmentsByKey = new Map(attachmentRows.map((row) => [row.r2_key, row]))

  const verifiedAttachments = new Map<string, AttachmentRow>()
  const plans: RowPlan[] = []
  let pending = 0
  for (const row of rows) {
    const replacements = new Map<string, string>()
    for (const reference of row.references) {
      const resolved = replacementFor(reference, row.tenantId, attachmentsById, attachmentsByKey)
      const key = referenceKey(reference)
      const previous = replacements.get(key)
      if (previous && previous !== resolved.value) {
        throw new Error(`Attachment reference resolves inconsistently at ${reference.path}`)
      }
      replacements.set(key, resolved.value)
      if (reference.raw !== resolved.value) pending++
      verifiedAttachments.set(resolved.attachment.id, resolved.attachment)
    }
    const plan = rewriteInspectedRow(row, replacements)
    const changed =
      plan.table === 'form_responses'
        ? !formResponseEqual(plan.before, plan.after)
        : !trainingEqual(plan.before, plan.after)
    if (changed) plans.push(plan)
  }

  for (const attachment of verifiedAttachments.values()) {
    await assertAttachmentObject(attachment)
  }
  await assertStoragePrivacy(verifiedAttachments.values().next().value)

  return {
    plans,
    stats: {
      rowsScanned: rows.length,
      references: references.length,
      routes: references.filter((reference) => reference.kind === 'route').length,
      public: references.filter((reference) => reference.kind === 'public-object').length,
      pending,
      invalid: invalid.length,
      changedRows: plans.length,
    },
  }
}

async function applyPlans(plans: readonly RowPlan[]): Promise<number> {
  if (plans.length === 0) return 0
  return sql.begin(async (tx) => {
    let mutations = 0
    for (const plan of plans) {
      if (plan.table === 'form_responses') {
        const [current] = await tx<FormResponseRow[]>`
          select id::text, tenant_id::text, data, draft_data,
                 draft_data is null as draft_data_sql_null, workflow_state,
                 workflow_state is null as workflow_state_sql_null
          from form_responses where id = ${plan.id}::uuid for update
        `
        if (!current) throw new Error(`form_responses ${plan.id} disappeared during cutover`)
        const snapshot: FormResponseSnapshot = {
          data: current.data,
          draftData: { value: current.draft_data, sqlNull: current.draft_data_sql_null },
          workflowState: {
            value: current.workflow_state,
            sqlNull: current.workflow_state_sql_null,
          },
        }
        if (current.tenant_id !== plan.tenantId || !formResponseEqual(snapshot, plan.before)) {
          throw new Error(`form_responses ${plan.id} changed after preflight`)
        }
        const updated = await tx<{ id: string }[]>`
          update form_responses
          set data = ${JSON.stringify(plan.after.data)}::jsonb,
              draft_data = case when ${plan.after.draftData.sqlNull} then null
                                else ${JSON.stringify(plan.after.draftData.value)}::jsonb end,
              workflow_state = case when ${plan.after.workflowState.sqlNull} then null
                                    else ${JSON.stringify(plan.after.workflowState.value)}::jsonb end,
              updated_at = now()
          where id = ${plan.id}::uuid and tenant_id = ${plan.tenantId}::uuid
            and data is not distinct from ${JSON.stringify(plan.before.data)}::jsonb
            and draft_data is not distinct from
                (case when ${plan.before.draftData.sqlNull} then null
                      else ${JSON.stringify(plan.before.draftData.value)}::jsonb end)
            and workflow_state is not distinct from
                (case when ${plan.before.workflowState.sqlNull} then null
                      else ${JSON.stringify(plan.before.workflowState.value)}::jsonb end)
          returning id::text
        `
        if (updated.length !== 1) {
          throw new Error(`form_responses ${plan.id} was not updated exactly once`)
        }
      } else {
        const table = plan.table
        const currentRows =
          table === 'training_lessons'
            ? await tx<TrainingRow[]>`
                select id::text, tenant_id::text, content_html, content_json,
                       content_json is null as content_json_sql_null, slides
                from training_lessons where id = ${plan.id}::uuid for update
              `
            : await tx<TrainingRow[]>`
                select id::text, tenant_id::text, content_html, content_json,
                       content_json is null as content_json_sql_null, slides
                from training_content_items where id = ${plan.id}::uuid for update
              `
        const current = currentRows[0]
        if (!current) throw new Error(`${table} ${plan.id} disappeared during cutover`)
        const snapshot: TrainingSnapshot = {
          contentHtml: current.content_html,
          contentJson: {
            value: current.content_json,
            sqlNull: current.content_json_sql_null,
          },
          slides: current.slides,
        }
        if (current.tenant_id !== plan.tenantId || !trainingEqual(snapshot, plan.before)) {
          throw new Error(`${table} ${plan.id} changed after preflight`)
        }
        const updated =
          table === 'training_lessons'
            ? await tx<{ id: string }[]>`
                update training_lessons
                set content_html = ${plan.after.contentHtml},
                    content_json = case when ${plan.after.contentJson.sqlNull} then null
                                        else ${JSON.stringify(plan.after.contentJson.value)}::jsonb end,
                    slides = ${JSON.stringify(plan.after.slides)}::jsonb,
                    updated_at = now()
                where id = ${plan.id}::uuid and tenant_id = ${plan.tenantId}::uuid
                  and content_html is not distinct from ${plan.before.contentHtml}
                  and content_json is not distinct from
                      (case when ${plan.before.contentJson.sqlNull} then null
                            else ${JSON.stringify(plan.before.contentJson.value)}::jsonb end)
                  and slides is not distinct from ${JSON.stringify(plan.before.slides)}::jsonb
                returning id::text
              `
            : await tx<{ id: string }[]>`
                update training_content_items
                set content_html = ${plan.after.contentHtml},
                    content_json = case when ${plan.after.contentJson.sqlNull} then null
                                        else ${JSON.stringify(plan.after.contentJson.value)}::jsonb end,
                    slides = ${JSON.stringify(plan.after.slides)}::jsonb,
                    updated_at = now()
                where id = ${plan.id}::uuid and tenant_id = ${plan.tenantId}::uuid
                  and content_html is not distinct from ${plan.before.contentHtml}
                  and content_json is not distinct from
                      (case when ${plan.before.contentJson.sqlNull} then null
                            else ${JSON.stringify(plan.before.contentJson.value)}::jsonb end)
                  and slides is not distinct from ${JSON.stringify(plan.before.slides)}::jsonb
                returning id::text
              `
        if (updated.length !== 1)
          throw new Error(`${table} ${plan.id} was not updated exactly once`)
      }
      mutations++
    }
    return mutations
  })
}

function assertPostcondition(prepared: PreparedCutover): void {
  const { pending, invalid, public: publicCount, changedRows } = prepared.stats
  if (pending !== 0 || invalid !== 0 || publicCount !== 0 || changedRows !== 0) {
    throw new Error(
      `Attachment URL postcondition failed: pending=${pending}, invalid=${invalid}, public=${publicCount}, changedRows=${changedRows}`,
    )
  }
}

async function auditOnly(): Promise<void> {
  const prepared = await prepareCutover()
  console.log('[attachment-url-cutover]', { mode: 'AUDIT-ONLY', ...prepared.stats })
}

async function applyCutover(): Promise<void> {
  const lockConnection = await lockSql.reserve()
  let lockHeld = false
  try {
    const [lock] = await lockConnection<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${LOCK_NAME}, 0)) as locked
    `
    if (!lock?.locked) throw new Error('Another attachment URL cutover holds the advisory lock')
    lockHeld = true

    // This is the final all-row/all-object preflight and occurs under the lock.
    const prepared = await prepareCutover()
    console.log('[attachment-url-cutover]', { mode: 'APPLY', ...prepared.stats })
    const mutations = await applyPlans(prepared.plans)
    if (mutations !== prepared.stats.changedRows) {
      throw new Error('Attachment URL cutover mutation count did not match its preflight plan')
    }

    const after = await prepareCutover()
    assertPostcondition(after)
    const secondApplyMutations = await applyPlans(after.plans)
    if (secondApplyMutations !== 0) {
      throw new Error('Attachment URL cutover was not idempotent on its second apply pass')
    }
    const final = await prepareCutover()
    assertPostcondition(final)
    console.log('[attachment-url-cutover] complete', {
      mutations,
      secondApplyMutations,
      ...final.stats,
    })
  } finally {
    try {
      if (lockHeld) {
        await lockConnection`select pg_advisory_unlock(hashtextextended(${LOCK_NAME}, 0))`
      }
    } finally {
      lockConnection.release()
    }
  }
}

async function main(): Promise<void> {
  await assertCutoverDatabaseSession(sql)
  if (APPLY) await applyCutover()
  else await auditOnly()
}

main()
  .catch((error: unknown) => {
    console.error(
      '[attachment-url-cutover] FAILED:',
      error instanceof Error ? error.message : error,
    )
    process.exitCode = 1
  })
  .finally(async () => {
    await Promise.all([sql.end({ timeout: 5 }), lockSql.end({ timeout: 5 })])
  })
