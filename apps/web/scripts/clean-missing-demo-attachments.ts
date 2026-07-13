/**
 * Remove three seeded demo attachment rows whose object-store bytes never existed,
 * including the exact file lesson that points at the missing demo PDF.
 *
 * Audit mode is read-only and accepts either the exact pending snapshot or the
 * exact completed snapshot. Apply mode requires the direct dev database and
 * drained writers, repeats every check under one reserved-connection
 * transaction, writes deduplicated audit evidence, and proves a second pass is
 * mutation-free before committing.
 */

import { createClient } from '@beaconhs/db'
import {
  DEMO_ATTACHMENT_IDS,
  DEMO_ATTACHMENT_KEYS,
  FILE_LESSON_ID,
  RICH_LESSON_ID,
  SLIDE_LESSON_ID,
  canonicalJson,
  cleanRichLessonHtml,
  cleanSlideLesson,
  contentHash,
  type JsonValue,
} from './missing-demo-attachment-cleanup'
import {
  assertCutoverDatabaseSession,
  requireCutoverDatabaseTarget,
  requireCutoverStorageTarget,
} from './cutover-target'

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = requireCutoverDatabaseTarget(APPLY)
const STORAGE_TARGET = requireCutoverStorageTarget()

// Storage configuration is captured during package evaluation. Do not import
// it until the audited cutover coordinates above have been validated.
const storage = await import('@beaconhs/storage')
if (storage.BUCKET !== STORAGE_TARGET.bucket) {
  throw new Error('Storage package bucket does not match the audited cutover target')
}

const TENANT_ID = '362623eb-f615-4610-b2f9-3422dde18cf4'
const LOCK_NAME = 'beaconhs:missing-demo-attachment-cleanup:v1'
const AUDIT_PREFIX = 'missing-demo-attachment-cleanup:v1:'
const CLEANUP_REASON = 'referenced object is absent from the audited object store'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASHES = {
  richBefore: '25ef75222dd0edc080467d99b39f896240e05c0a909249e387536a5924264db2',
  richAfter: 'd1968c25c31f5cf5a22fe0ccf6e74fb3d844143fa5a9dffc7b359aa75cfb296d',
  slidesBefore: '3b7628851a592f060a523d93bfc9a949e52d809e79cd7c864a3bd63472f0ae03',
  slidesAfter: '59d385bb215d894edb271f8aaf38d18d73281da80adfe9ff805c6b868e2a4cfd',
} as const

const { sql } = createClient({ url: DATABASE_URL, max: 1 })
type RootSql = typeof sql
type QuerySql = Parameters<Parameters<RootSql['begin']>[1]>[0]

type AttachmentSpec = {
  id: string
  tenant_id: string
  uploaded_by: null
  kind: 'image' | 'document'
  r2_key: string
  content_type: string
  size_bytes: string
  filename: string
  width: null
  height: null
  duration_ms: null
  captured_at: null
  geo_lat: null
  geo_lng: null
  exif: null
  annotations: null
  caption: null
  created_at: string
  updated_at: string
}

const ATTACHMENTS: readonly AttachmentSpec[] = (
  [
    {
      id: DEMO_ATTACHMENT_IDS.site,
      tenant_id: TENANT_ID,
      uploaded_by: null,
      kind: 'image',
      r2_key: DEMO_ATTACHMENT_KEYS.site,
      content_type: 'image/svg+xml',
      size_bytes: '732',
      filename: 'demo-site.svg',
      width: null,
      height: null,
      duration_ms: null,
      captured_at: null,
      geo_lat: null,
      geo_lng: null,
      exif: null,
      annotations: null,
      caption: null,
      created_at: '2026-06-10 02:38:48.227625+00',
      updated_at: '2026-06-10 02:38:48.227625+00',
    },
    {
      id: DEMO_ATTACHMENT_IDS.reference,
      tenant_id: TENANT_ID,
      uploaded_by: null,
      kind: 'document',
      r2_key: DEMO_ATTACHMENT_KEYS.reference,
      content_type: 'application/pdf',
      size_bytes: '963',
      filename: 'demo-quick-reference.pdf',
      width: null,
      height: null,
      duration_ms: null,
      captured_at: null,
      geo_lat: null,
      geo_lng: null,
      exif: null,
      annotations: null,
      caption: null,
      created_at: '2026-06-10 02:38:48.365355+00',
      updated_at: '2026-06-10 02:38:48.365355+00',
    },
    {
      id: DEMO_ATTACHMENT_IDS.hero,
      tenant_id: TENANT_ID,
      uploaded_by: null,
      kind: 'image',
      r2_key: DEMO_ATTACHMENT_KEYS.hero,
      content_type: 'image/svg+xml',
      size_bytes: '726',
      filename: 'demo-hero.svg',
      width: null,
      height: null,
      duration_ms: null,
      captured_at: null,
      geo_lat: null,
      geo_lng: null,
      exif: null,
      annotations: null,
      caption: null,
      created_at: '2026-06-10 02:38:48.096179+00',
      updated_at: '2026-06-10 02:38:48.096179+00',
    },
  ] satisfies AttachmentSpec[]
).sort((left, right) => left.id.localeCompare(right.id))

type LessonRow = {
  id: string
  tenant_id: string
  course_id: string
  module_id: string
  title: string
  kind: string
  sort_order: number
  content_html: string | null
  content_json: JsonValue
  slides: JsonValue
  practical_criteria: JsonValue
  import_status: string | null
  import_error: string | null
  source_attachment_id: string | null
  assessment_type_id: string | null
  class_id: string | null
  attachment_id: string | null
  embed_url: string | null
  content_item_id: string | null
  duration_minutes: number | null
  is_required: boolean
  completion_rule: string
  min_time_seconds: number | null
  content_blocks: JsonValue
  deleted_at: string | null
  created_at: string
  updated_at: string
}

const FILE_LESSON: LessonRow = {
  id: FILE_LESSON_ID,
  tenant_id: TENANT_ID,
  course_id: '748fb150-70c6-4f82-b1cc-3d1e8b7cd765',
  module_id: '48d1d28b-3f65-4064-bac4-73c45c542d4f',
  title: 'Quick-reference handout (PDF)',
  kind: 'file',
  sort_order: 2,
  content_html: null,
  content_json: null,
  slides: [],
  practical_criteria: [],
  import_status: null,
  import_error: null,
  source_attachment_id: null,
  assessment_type_id: null,
  class_id: null,
  attachment_id: DEMO_ATTACHMENT_IDS.reference,
  embed_url: null,
  content_item_id: null,
  duration_minutes: null,
  is_required: true,
  completion_rule: 'acknowledge',
  min_time_seconds: null,
  content_blocks: [],
  deleted_at: null,
  created_at: '2026-06-10 02:38:48.464174+00',
  updated_at: '2026-06-10 02:38:48.464174+00',
}

type TextReference = {
  table_name: string
  column_name: string
  row_id: string
  token: string
  occurrences: number
}

type UuidReference = TextReference & {
  storage: 'scalar' | 'array'
}

type UuidColumn = {
  table_name: string
  column_name: string
  storage: 'scalar' | 'array'
}

type ForeignKeyReference = {
  constraint_name: string
  table_name: string
  local_columns: string[]
  referenced_columns: string[]
}

type AuditRow = {
  id: string
  tenant_id: string
  actor_user_id: string | null
  actor_ip: string | null
  actor_user_agent: string | null
  entity_type: string
  entity_id: string | null
  action: string
  dedup_key: string
  summary: string | null
  before: JsonValue
  after: JsonValue
  metadata: JsonValue
  occurred_at: string
}

type AuditSpec = Omit<AuditRow, 'id' | 'occurred_at'>

const AUDIT_METADATA = {
  cleanup: 'missing-demo-attachments-v1',
  reason: CLEANUP_REASON,
} satisfies JsonValue

const LESSON_AUDITS: AuditSpec[] = [
  {
    tenant_id: TENANT_ID,
    actor_user_id: null,
    actor_ip: null,
    actor_user_agent: null,
    entity_type: 'training_lesson',
    entity_id: RICH_LESSON_ID,
    action: 'update',
    dedup_key: `${AUDIT_PREFIX}lesson:rich`,
    summary: 'Removed a missing seeded demo image from rich lesson content',
    before: { contentHash: HASHES.richBefore, missingImageParagraphs: 1 },
    after: { contentHash: HASHES.richAfter, missingImageParagraphs: 0 },
    metadata: AUDIT_METADATA,
  },
  {
    tenant_id: TENANT_ID,
    actor_user_id: null,
    actor_ip: null,
    actor_user_agent: null,
    entity_type: 'training_lesson',
    entity_id: SLIDE_LESSON_ID,
    action: 'update',
    dedup_key: `${AUDIT_PREFIX}lesson:slides`,
    summary: 'Removed two missing seeded demo images from slide lesson content',
    before: {
      contentHash: HASHES.slidesBefore,
      missingImageElements: 2,
      finalSlideBackgroundColor: '#ffffff',
    },
    after: {
      contentHash: HASHES.slidesAfter,
      missingImageElements: 0,
      finalSlideBackgroundColor: '#134e4a',
    },
    metadata: AUDIT_METADATA,
  },
  {
    tenant_id: TENANT_ID,
    actor_user_id: null,
    actor_ip: null,
    actor_user_agent: null,
    entity_type: 'training_lesson',
    entity_id: FILE_LESSON_ID,
    action: 'delete',
    dedup_key: `${AUDIT_PREFIX}lesson:file`,
    summary: 'Deleted a seeded demo file lesson whose PDF object is missing',
    before: {
      id: FILE_LESSON.id,
      courseId: FILE_LESSON.course_id,
      moduleId: FILE_LESSON.module_id,
      title: FILE_LESSON.title,
      kind: FILE_LESSON.kind,
      sortOrder: FILE_LESSON.sort_order,
      attachmentId: FILE_LESSON.attachment_id,
      completionRule: FILE_LESSON.completion_rule,
      isRequired: FILE_LESSON.is_required,
      objectPresent: false,
    },
    after: null,
    metadata: AUDIT_METADATA,
  },
]

const AUDITS: readonly AuditSpec[] = [
  ...LESSON_AUDITS,
  ...ATTACHMENTS.map(
    (attachment): AuditSpec => ({
      tenant_id: TENANT_ID,
      actor_user_id: null,
      actor_ip: null,
      actor_user_agent: null,
      entity_type: 'attachment',
      entity_id: attachment.id,
      action: 'delete',
      dedup_key: `${AUDIT_PREFIX}attachment:${attachment.filename}`,
      summary: `Deleted missing seeded demo attachment ${attachment.filename}`,
      before: {
        filename: attachment.filename,
        kind: attachment.kind,
        contentType: attachment.content_type,
        sizeBytes: Number(attachment.size_bytes),
        objectPresent: false,
      },
      after: null,
      metadata: AUDIT_METADATA,
    }),
  ),
].sort((left, right) => left.dedup_key.localeCompare(right.dedup_key))

type PreparedState =
  | {
      status: 'PENDING'
      rich: LessonRow
      slides: LessonRow
      file: LessonRow
      richAfter: string
      slidesAfter: JsonValue
      foreignKeyChecks: number
      textJsonReferences: number
      attachmentUuidReferences: number
      fileLessonUuidReferences: number
    }
  | {
      status: 'COMPLETE'
      rich: LessonRow
      slides: LessonRow
      foreignKeyChecks: number
      textJsonReferences: 0
      attachmentUuidReferences: 0
      fileLessonUuidReferences: 0
    }

function valuesEqual(left: JsonValue, right: JsonValue): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function assertExactObject(actual: object, expected: object, label: string): void {
  if (!valuesEqual(actual as JsonValue, expected as JsonValue)) {
    throw new Error(`${label} does not match the audited snapshot`)
  }
}

async function assertObjectsMissing(): Promise<void> {
  for (const attachment of ATTACHMENTS) {
    const probe = attachment.r2_key
    if ((await storage.headObject({ key: probe })) !== null) {
      throw new Error(`Attachment ${attachment.id} unexpectedly has an object`)
    }
  }
}

async function attachmentRows(db: QuerySql): Promise<AttachmentSpec[]> {
  const ids = ATTACHMENTS.map((attachment) => attachment.id)
  return db<AttachmentSpec[]>`
    select id::text, tenant_id::text, uploaded_by, kind, r2_key, content_type,
           size_bytes::text, filename, width::text, height::text, duration_ms::text,
           captured_at::text, geo_lat, geo_lng, exif, annotations, caption,
           created_at::text, updated_at::text
      from attachments
     where id = any(${ids}::uuid[])
     order by id
  `
}

async function lessonRows(db: QuerySql): Promise<LessonRow[]> {
  return db<LessonRow[]>`
    select id::text, tenant_id::text, course_id::text, module_id::text, title, kind,
           sort_order, content_html, content_json, slides, practical_criteria,
           import_status, import_error, source_attachment_id::text,
           assessment_type_id::text, class_id::text, attachment_id::text, embed_url,
           content_item_id::text, duration_minutes, is_required, completion_rule,
           min_time_seconds, content_blocks, deleted_at::text, created_at::text,
           updated_at::text
      from training_lessons
     where id = any(${[RICH_LESSON_ID, SLIDE_LESSON_ID, FILE_LESSON_ID]}::uuid[])
     order by id
  `
}

async function auditRows(db: QuerySql): Promise<AuditRow[]> {
  return db<AuditRow[]>`
    select id::text, tenant_id::text, actor_user_id, actor_ip, actor_user_agent, entity_type,
           entity_id::text, action, dedup_key, summary, before, after, metadata,
           occurred_at::text
      from audit_log
     where tenant_id = ${TENANT_ID}::uuid and dedup_key like ${`${AUDIT_PREFIX}%`}
     order by dedup_key
  `
}

async function foreignKeyDefinitions(db: QuerySql): Promise<ForeignKeyReference[]> {
  return db<ForeignKeyReference[]>`
    select constraint_row.conname as constraint_name,
           source_table.relname as table_name,
           array_agg(source_column.attname order by key_column.ordinality)::text[] as local_columns,
           array_agg(target_column.attname order by key_column.ordinality)::text[] as referenced_columns
      from pg_constraint constraint_row
      join pg_class source_table on source_table.oid = constraint_row.conrelid
      join pg_namespace source_schema on source_schema.oid = source_table.relnamespace
      cross join lateral unnest(constraint_row.conkey, constraint_row.confkey)
        with ordinality as key_column(source_attnum, target_attnum, ordinality)
      join pg_attribute source_column
        on source_column.attrelid = constraint_row.conrelid
       and source_column.attnum = key_column.source_attnum
      join pg_attribute target_column
        on target_column.attrelid = constraint_row.confrelid
       and target_column.attnum = key_column.target_attnum
     where constraint_row.contype = 'f'
       and constraint_row.confrelid = 'public.attachments'::regclass
       and source_schema.nspname = 'public'
     group by constraint_row.conname, source_table.relname
     order by source_table.relname, constraint_row.conname
  `
}

function referencedValue(attachment: AttachmentSpec, column: string): JsonValue {
  switch (column) {
    case 'id':
      return attachment.id
    case 'tenant_id':
      return attachment.tenant_id
    case 'r2_key':
      return attachment.r2_key
    default:
      throw new Error(`Unsupported attachments reference column ${column}`)
  }
}

async function assertNoForeignKeyReferences(db: QuerySql): Promise<number> {
  const definitions = await foreignKeyDefinitions(db)
  let checked = 0
  for (const definition of definitions) {
    if (definition.local_columns.length !== definition.referenced_columns.length) {
      throw new Error(`Foreign key ${definition.constraint_name} has inconsistent column mapping`)
    }
    for (const attachment of ATTACHMENTS) {
      const expected = Object.fromEntries(
        definition.local_columns.map((localColumn, index) => [
          localColumn,
          referencedValue(attachment, definition.referenced_columns[index]!),
        ]),
      )
      const [result] = await db<{ count: number }[]>`
        select count(*)::integer as count
          from ${db(definition.table_name)} as referenced_row
         where to_jsonb(referenced_row) @> ${JSON.stringify(expected)}::jsonb
      `
      if (!result || result.count !== 0) {
        throw new Error(
          `Attachment ${attachment.id} has ${result?.count ?? 'unknown'} row(s) through ${definition.constraint_name}`,
        )
      }
      checked++
    }
  }
  return checked
}

async function textColumns(db: QuerySql): Promise<{ table_name: string; column_name: string }[]> {
  return db<{ table_name: string; column_name: string }[]>`
    select table_row.relname as table_name, column_row.attname as column_name
      from pg_class table_row
      join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
      join pg_attribute column_row on column_row.attrelid = table_row.oid
      join pg_type type_row on type_row.oid = column_row.atttypid
      left join pg_type element_type_row on element_type_row.oid = type_row.typelem
     where schema_row.nspname = 'public'
       and table_row.relkind in ('r', 'p')
       and not exists (
         select 1 from pg_inherits inheritance where inheritance.inhrelid = table_row.oid
       )
       and column_row.attnum > 0
       and not column_row.attisdropped
       and column_row.attgenerated = ''
       and (
         type_row.typcategory = 'S'
         or type_row.typname in ('json', 'jsonb')
         or element_type_row.typcategory = 'S'
         or element_type_row.typname in ('json', 'jsonb')
       )
     order by table_row.relname, column_row.attname
  `
}

function compareTextReference(left: TextReference, right: TextReference): number {
  return [left.table_name, left.column_name, left.row_id, left.token]
    .join('\0')
    .localeCompare([right.table_name, right.column_name, right.row_id, right.token].join('\0'))
}

function compareUuidReference(left: UuidReference, right: UuidReference): number {
  return [left.table_name, left.column_name, left.row_id, left.token, left.storage]
    .join('\0')
    .localeCompare(
      [right.table_name, right.column_name, right.row_id, right.token, right.storage].join('\0'),
    )
}

async function uuidColumns(db: QuerySql): Promise<UuidColumn[]> {
  return db<UuidColumn[]>`
    select table_row.relname as table_name,
           column_row.attname as column_name,
           case when type_row.typname = 'uuid' then 'scalar' else 'array' end as storage
      from pg_class table_row
      join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
      join pg_attribute column_row on column_row.attrelid = table_row.oid
      join pg_type type_row on type_row.oid = column_row.atttypid
      left join pg_type element_type_row on element_type_row.oid = type_row.typelem
     where schema_row.nspname = 'public'
       and table_row.relkind in ('r', 'p')
       and not exists (
         select 1 from pg_inherits inheritance where inheritance.inhrelid = table_row.oid
       )
       and column_row.attnum > 0
       and not column_row.attisdropped
       and (type_row.typname = 'uuid' or element_type_row.typname = 'uuid')
     order by table_row.relname, column_row.attname
  `
}

async function allUuidReferences(
  db: QuerySql,
  tokens: readonly string[],
): Promise<UuidReference[]> {
  if (tokens.length === 0) return []
  const references: UuidReference[] = []
  const columns = await uuidColumns(db)
  for (const [index, column] of columns.entries()) {
    if (column.storage === 'scalar') {
      const matches = await db<UuidReference[]>`
        select ${column.table_name} as table_name,
               ${column.column_name} as column_name,
               coalesce(to_jsonb(candidate_row) ->> 'id', candidate_row.ctid::text) as row_id,
               ${db(column.column_name)}::text as token,
               1::integer as occurrences,
               'scalar'::text as storage
          from ${db(column.table_name)} as candidate_row
         where ${db(column.column_name)} = any(${tokens}::uuid[])
      `
      references.push(...matches)
      if ((index + 1) % 100 === 0) {
        console.log(`[missing-demo-attachments] UUID scan columns=${index + 1}/${columns.length}`)
      }
      continue
    }
    const matches = await db<UuidReference[]>`
      select ${column.table_name} as table_name,
             ${column.column_name} as column_name,
             coalesce(to_jsonb(candidate_row) ->> 'id', candidate_row.ctid::text) as row_id,
             token_row.token::text as token,
             (
               select count(*)::integer
                 from unnest(${db(column.column_name)}) as array_value(value)
                where array_value.value = token_row.token
             ) as occurrences,
             'array'::text as storage
        from ${db(column.table_name)} as candidate_row
        cross join unnest(${tokens}::uuid[]) as token_row(token)
       where token_row.token = any(${db(column.column_name)})
    `
    references.push(...matches)
    if ((index + 1) % 100 === 0) {
      console.log(`[missing-demo-attachments] UUID scan columns=${index + 1}/${columns.length}`)
    }
  }
  console.log(
    `[missing-demo-attachments] UUID scan complete columns=${columns.length} references=${references.length}`,
  )
  return references.sort(compareUuidReference)
}

async function allTextReferences(db: QuerySql): Promise<TextReference[]> {
  const tokens = [
    ...Object.values(DEMO_ATTACHMENT_IDS),
    ...Object.values(DEMO_ATTACHMENT_KEYS),
    FILE_LESSON_ID,
  ]
  const references: TextReference[] = []
  const columns = await textColumns(db)
  for (const [index, column] of columns.entries()) {
    const matches = await db<TextReference[]>`
      select ${column.table_name} as table_name,
             ${column.column_name} as column_name,
             coalesce(to_jsonb(candidate_row) ->> 'id', candidate_row.ctid::text) as row_id,
             token_row.token,
             ((length(cell_value.value) - length(replace(cell_value.value, token_row.token, '')))
               / length(token_row.token))::integer as occurrences
        from ${db(column.table_name)} as candidate_row
        cross join lateral (
          select coalesce(to_jsonb(candidate_row) ->> ${column.column_name}, '') as value
        ) as cell_value
        cross join unnest(${tokens}::text[]) as token_row(token)
       where strpos(cell_value.value, token_row.token) > 0
    `
    references.push(...matches)
    if ((index + 1) % 100 === 0) {
      console.log(
        `[missing-demo-attachments] text/JSON scan columns=${index + 1}/${columns.length}`,
      )
    }
  }
  console.log(
    `[missing-demo-attachments] text/JSON scan complete columns=${columns.length} references=${references.length}`,
  )
  return references.sort(compareTextReference)
}

function pendingTextReferences(): TextReference[] {
  return [
    ...ATTACHMENTS.map((attachment) => ({
      table_name: 'attachments',
      column_name: 'r2_key',
      row_id: attachment.id,
      token: attachment.r2_key,
      occurrences: 1,
    })),
    {
      table_name: 'training_lessons',
      column_name: 'content_html',
      row_id: RICH_LESSON_ID,
      token: DEMO_ATTACHMENT_KEYS.hero,
      occurrences: 1,
    },
    {
      table_name: 'training_lessons',
      column_name: 'slides',
      row_id: SLIDE_LESSON_ID,
      token: DEMO_ATTACHMENT_IDS.site,
      occurrences: 1,
    },
    {
      table_name: 'training_lessons',
      column_name: 'slides',
      row_id: SLIDE_LESSON_ID,
      token: DEMO_ATTACHMENT_IDS.hero,
      occurrences: 1,
    },
  ].sort(compareTextReference)
}

function pendingAttachmentUuidReferences(): UuidReference[] {
  return [
    ...ATTACHMENTS.map((attachment) => ({
      table_name: 'attachments',
      column_name: 'id',
      row_id: attachment.id,
      token: attachment.id,
      occurrences: 1,
      storage: 'scalar' as const,
    })),
    {
      table_name: 'training_lessons',
      column_name: 'attachment_id',
      row_id: FILE_LESSON_ID,
      token: DEMO_ATTACHMENT_IDS.reference,
      occurrences: 1,
      storage: 'scalar' as const,
    },
  ].sort(compareUuidReference)
}

function pendingFileLessonUuidReferences(): UuidReference[] {
  return [
    {
      table_name: 'training_lessons',
      column_name: 'id',
      row_id: FILE_LESSON_ID,
      token: FILE_LESSON_ID,
      occurrences: 1,
      storage: 'scalar',
    },
  ]
}

function auditWithDedupKey(rows: AuditRow[], dedupKey: string): AuditRow {
  const matches = rows.filter((row) => row.dedup_key === dedupKey)
  if (matches.length !== 1) throw new Error(`Expected one audit row ${dedupKey}`)
  return matches[0]!
}

function completedAuditTextReferences(rows: AuditRow[]): TextReference[] {
  const fileAudit = auditWithDedupKey(rows, `${AUDIT_PREFIX}lesson:file`)
  return [
    {
      table_name: 'audit_log',
      column_name: 'before',
      row_id: fileAudit.id,
      token: DEMO_ATTACHMENT_IDS.reference,
      occurrences: 1,
    },
    {
      table_name: 'audit_log',
      column_name: 'before',
      row_id: fileAudit.id,
      token: FILE_LESSON_ID,
      occurrences: 1,
    },
  ].sort(compareTextReference)
}

function completedAuditAttachmentUuidReferences(rows: AuditRow[]): UuidReference[] {
  return ATTACHMENTS.map((attachment) => {
    const audit = auditWithDedupKey(rows, `${AUDIT_PREFIX}attachment:${attachment.filename}`)
    return {
      table_name: 'audit_log',
      column_name: 'entity_id',
      row_id: audit.id,
      token: attachment.id,
      occurrences: 1,
      storage: 'scalar' as const,
    }
  }).sort(compareUuidReference)
}

function completedAuditFileLessonUuidReferences(rows: AuditRow[]): UuidReference[] {
  const audit = auditWithDedupKey(rows, `${AUDIT_PREFIX}lesson:file`)
  return [
    {
      table_name: 'audit_log',
      column_name: 'entity_id',
      row_id: audit.id,
      token: FILE_LESSON_ID,
      occurrences: 1,
      storage: 'scalar',
    },
  ]
}

function assertLessonIdentity(rich: LessonRow, slides: LessonRow): void {
  assertExactObject(
    {
      id: rich.id,
      tenant_id: rich.tenant_id,
      title: rich.title,
      kind: rich.kind,
      content_json: rich.content_json,
      slides: rich.slides,
      source_attachment_id: rich.source_attachment_id,
      attachment_id: rich.attachment_id,
      deleted_at: rich.deleted_at,
    },
    {
      id: RICH_LESSON_ID,
      tenant_id: TENANT_ID,
      title: 'Welcome & objectives',
      kind: 'rich',
      content_json: null,
      slides: [],
      source_attachment_id: null,
      attachment_id: null,
      deleted_at: null,
    },
    'Rich lesson identity',
  )
  assertExactObject(
    {
      id: slides.id,
      tenant_id: slides.tenant_id,
      title: slides.title,
      kind: slides.kind,
      content_html: slides.content_html,
      content_json: slides.content_json,
      source_attachment_id: slides.source_attachment_id,
      attachment_id: slides.attachment_id,
      deleted_at: slides.deleted_at,
    },
    {
      id: SLIDE_LESSON_ID,
      tenant_id: TENANT_ID,
      title: 'Working at Height — slides',
      kind: 'slides',
      content_html: null,
      content_json: null,
      source_attachment_id: null,
      attachment_id: null,
      deleted_at: null,
    },
    'Slide lesson identity',
  )
}

function assertFileLessonIdentity(file: LessonRow): void {
  assertExactObject(file, FILE_LESSON, 'File lesson identity')
}

function assertAudits(rows: AuditRow[]): void {
  if (rows.length !== AUDITS.length) {
    throw new Error(`Expected ${AUDITS.length} cleanup audit rows, found ${rows.length}`)
  }
  for (let index = 0; index < AUDITS.length; index++) {
    const row = rows[index]!
    const expected = AUDITS[index]!
    if (!UUID_RE.test(row.id)) throw new Error(`Audit ${expected.dedup_key} has no valid id`)
    if (!row.occurred_at) throw new Error(`Audit ${expected.dedup_key} has no occurrence timestamp`)
    const { id: _id, occurred_at: _occurredAt, ...comparable } = row
    assertExactObject(comparable, expected, `Audit ${expected.dedup_key}`)
  }
}

async function inspectState(db: QuerySql): Promise<PreparedState> {
  await assertObjectsMissing()
  const attachments = await attachmentRows(db)
  const lessons = await lessonRows(db)
  const foreignKeyChecks = await assertNoForeignKeyReferences(db)
  const references = await allTextReferences(db)
  const uuidReferences = await allUuidReferences(db, [
    ...Object.values(DEMO_ATTACHMENT_IDS),
    FILE_LESSON_ID,
  ])
  const domainReferences = references.filter((reference) => reference.table_name !== 'audit_log')
  const auditReferences = references.filter((reference) => reference.table_name === 'audit_log')
  const attachmentIds = new Set<string>(Object.values(DEMO_ATTACHMENT_IDS))
  const attachmentUuidReferences = uuidReferences.filter((reference) =>
    attachmentIds.has(reference.token),
  )
  const fileLessonUuidReferences = uuidReferences.filter(
    (reference) => reference.token === FILE_LESSON_ID,
  )
  const domainAttachmentUuidReferences = attachmentUuidReferences.filter(
    (reference) => reference.table_name !== 'audit_log',
  )
  const auditAttachmentUuidReferences = attachmentUuidReferences.filter(
    (reference) => reference.table_name === 'audit_log',
  )
  const domainFileLessonUuidReferences = fileLessonUuidReferences.filter(
    (reference) => reference.table_name !== 'audit_log',
  )
  const auditFileLessonUuidReferences = fileLessonUuidReferences.filter(
    (reference) => reference.table_name === 'audit_log',
  )
  const audits = await auditRows(db)
  const rich = lessons.find((lesson) => lesson.id === RICH_LESSON_ID)
  const slides = lessons.find((lesson) => lesson.id === SLIDE_LESSON_ID)
  const file = lessons.find((lesson) => lesson.id === FILE_LESSON_ID)
  if (!rich || !slides) throw new Error('One or both retained demo lessons are missing')
  assertLessonIdentity(rich, slides)

  if (attachments.length === ATTACHMENTS.length) {
    if (lessons.length !== 3 || !file) {
      throw new Error(`Pending cleanup expected three demo lessons, found ${lessons.length}`)
    }
    assertFileLessonIdentity(file)
    assertExactObject(attachments, ATTACHMENTS, 'Demo attachment rows')
    if (audits.length !== 0) throw new Error('Pending cleanup already has audit rows')
    assertExactObject(domainReferences, pendingTextReferences(), 'Pending text/JSON references')
    assertExactObject(auditReferences, [], 'Pending audit text/JSON references')
    assertExactObject(
      domainAttachmentUuidReferences,
      pendingAttachmentUuidReferences(),
      'Pending attachment UUID references',
    )
    assertExactObject(
      domainFileLessonUuidReferences,
      pendingFileLessonUuidReferences(),
      'Pending file lesson UUID references',
    )
    assertExactObject(auditAttachmentUuidReferences, [], 'Pending audit attachment UUID references')
    assertExactObject(
      auditFileLessonUuidReferences,
      [],
      'Pending audit file lesson UUID references',
    )
    if (rich.content_html === null) throw new Error('Pending rich lesson has null HTML')
    if (contentHash(rich.content_html) !== HASHES.richBefore) {
      throw new Error('Pending rich lesson hash does not match the audited snapshot')
    }
    if (contentHash(slides.slides) !== HASHES.slidesBefore) {
      throw new Error('Pending slide lesson hash does not match the audited snapshot')
    }
    const richAfter = cleanRichLessonHtml(rich.content_html)
    const slidesAfter = cleanSlideLesson(slides.slides)
    if (
      contentHash(richAfter) !== HASHES.richAfter ||
      contentHash(slidesAfter) !== HASHES.slidesAfter
    ) {
      throw new Error('Cleanup output does not match the independently audited postcondition')
    }
    return {
      status: 'PENDING',
      rich,
      slides,
      file,
      richAfter,
      slidesAfter,
      foreignKeyChecks,
      textJsonReferences: domainReferences.length,
      attachmentUuidReferences: domainAttachmentUuidReferences.length,
      fileLessonUuidReferences: domainFileLessonUuidReferences.length,
    }
  }

  if (attachments.length !== 0) {
    throw new Error(`Cleanup is partial: found ${attachments.length} of ${ATTACHMENTS.length} rows`)
  }
  if (lessons.length !== 2 || file) {
    throw new Error(`Completed cleanup expected two retained demo lessons, found ${lessons.length}`)
  }
  assertAudits(audits)
  if (domainReferences.length !== 0) {
    throw new Error(
      `Completed cleanup still has ${domainReferences.length} domain text/JSON reference(s)`,
    )
  }
  if (domainAttachmentUuidReferences.length !== 0 || domainFileLessonUuidReferences.length !== 0) {
    throw new Error(
      `Completed cleanup still has ${domainAttachmentUuidReferences.length} attachment and ${domainFileLessonUuidReferences.length} file-lesson domain UUID reference(s)`,
    )
  }
  assertExactObject(
    auditReferences,
    completedAuditTextReferences(audits),
    'Completed audit text/JSON references',
  )
  assertExactObject(
    auditAttachmentUuidReferences,
    completedAuditAttachmentUuidReferences(audits),
    'Completed audit attachment UUID references',
  )
  assertExactObject(
    auditFileLessonUuidReferences,
    completedAuditFileLessonUuidReferences(audits),
    'Completed audit file lesson UUID references',
  )
  if (
    rich.content_html === null ||
    contentHash(rich.content_html) !== HASHES.richAfter ||
    contentHash(slides.slides) !== HASHES.slidesAfter
  ) {
    throw new Error('Completed lesson content does not match the audited postcondition')
  }
  return {
    status: 'COMPLETE',
    rich,
    slides,
    foreignKeyChecks,
    textJsonReferences: 0,
    attachmentUuidReferences: 0,
    fileLessonUuidReferences: 0,
  }
}

async function insertAudit(db: QuerySql, audit: AuditSpec): Promise<void> {
  const inserted = await db<{ id: string }[]>`
    insert into audit_log
      (tenant_id, actor_user_id, actor_ip, actor_user_agent, entity_type, entity_id,
       action, dedup_key, summary, before, after, metadata)
    values
      (${audit.tenant_id}::uuid, null, null, null, ${audit.entity_type},
       ${audit.entity_id}::uuid, ${audit.action}, ${audit.dedup_key}, ${audit.summary},
       ${JSON.stringify(audit.before)}::jsonb, ${JSON.stringify(audit.after)}::jsonb,
       ${JSON.stringify(audit.metadata)}::jsonb)
    on conflict (tenant_id, dedup_key) do nothing
    returning id::text
  `
  if (inserted.length !== 1) throw new Error(`Audit ${audit.dedup_key} was not inserted once`)
}

async function applyPrepared(db: QuerySql, prepared: PreparedState): Promise<number> {
  if (prepared.status === 'COMPLETE') return 0
  const richUpdates = await db<{ id: string }[]>`
    update training_lessons
       set content_html = ${prepared.richAfter}, updated_at = now()
     where id = ${RICH_LESSON_ID}::uuid
       and tenant_id = ${TENANT_ID}::uuid
       and content_html = ${prepared.rich.content_html}
    returning id::text
  `
  if (richUpdates.length !== 1) throw new Error('Rich lesson was not updated exactly once')

  const slideUpdates = await db<{ id: string }[]>`
    update training_lessons
       set slides = ${JSON.stringify(prepared.slidesAfter)}::jsonb, updated_at = now()
     where id = ${SLIDE_LESSON_ID}::uuid
       and tenant_id = ${TENANT_ID}::uuid
       and slides = ${JSON.stringify(prepared.slides.slides)}::jsonb
    returning id::text
  `
  if (slideUpdates.length !== 1) throw new Error('Slide lesson was not updated exactly once')

  const deletedLessons = await db<{ id: string }[]>`
    delete from training_lessons
     where id = ${prepared.file.id}::uuid
       and tenant_id = ${prepared.file.tenant_id}::uuid
       and course_id = ${prepared.file.course_id}::uuid
       and module_id = ${prepared.file.module_id}::uuid
       and title = ${prepared.file.title}
       and kind = ${prepared.file.kind}::training_lesson_kind
       and attachment_id = ${prepared.file.attachment_id}::uuid
       and updated_at = ${prepared.file.updated_at}::timestamptz
    returning id::text
  `
  if (deletedLessons.length !== 1) throw new Error('File lesson was not deleted exactly once')

  for (const attachment of ATTACHMENTS) {
    const deleted = await db<{ id: string }[]>`
      delete from attachments
       where id = ${attachment.id}::uuid
         and tenant_id = ${attachment.tenant_id}::uuid
         and r2_key = ${attachment.r2_key}
         and filename = ${attachment.filename}
         and content_type = ${attachment.content_type}
         and size_bytes = ${attachment.size_bytes}::bigint
      returning id::text
    `
    if (deleted.length !== 1) throw new Error(`Attachment ${attachment.id} was not deleted once`)
  }
  for (const audit of AUDITS) await insertAudit(db, audit)
  return 12
}

async function timestampSnapshot(db: QuerySql): Promise<JsonValue> {
  const lessons = await db<{ id: string; updated_at: string }[]>`
    select id::text, updated_at::text
      from training_lessons
     where id = any(${[RICH_LESSON_ID, SLIDE_LESSON_ID, FILE_LESSON_ID]}::uuid[])
     order by id
  `
  const audits = await auditRows(db)
  return {
    lessons: lessons.map((lesson) => ({ id: lesson.id, updatedAt: lesson.updated_at })),
    audits: audits.map((audit) => ({ dedupKey: audit.dedup_key, occurredAt: audit.occurred_at })),
  }
}

async function auditOnly(): Promise<void> {
  const state = await inspectState(sql as unknown as QuerySql)
  console.log('[missing-demo-attachments]', {
    mode: 'AUDIT-ONLY',
    status: state.status,
    attachmentRows: state.status === 'PENDING' ? ATTACHMENTS.length : 0,
    foreignKeyChecks: state.foreignKeyChecks,
    textJsonReferences: state.textJsonReferences,
    attachmentUuidReferences: state.attachmentUuidReferences,
    fileLessonUuidReferences: state.fileLessonUuidReferences,
  })
}

async function applyCleanup(): Promise<void> {
  const connection = await sql.reserve()
  try {
    await assertCutoverDatabaseSession(connection)
    const result = await connection.begin(async (transaction) => {
      const db = transaction as QuerySql
      const [lock] = await db<{ locked: boolean }[]>`
        select pg_try_advisory_xact_lock(hashtextextended(${LOCK_NAME}, 0)) as locked
      `
      if (!lock?.locked) throw new Error('Another missing-demo cleanup holds the advisory lock')

      await db`
        select id from training_lessons
         where id = any(${[RICH_LESSON_ID, SLIDE_LESSON_ID, FILE_LESSON_ID]}::uuid[])
         order by id for update
      `
      await db`
        select id from attachments
         where id = any(${ATTACHMENTS.map((attachment) => attachment.id)}::uuid[])
         order by id for update
      `

      const prepared = await inspectState(db)
      const mutations = await applyPrepared(db, prepared)
      const postcondition = await inspectState(db)
      if (postcondition.status !== 'COMPLETE')
        throw new Error('Cleanup postcondition is not complete')
      const timestampsBeforeSecondApply = await timestampSnapshot(db)
      const secondApplyMutations = await applyPrepared(db, postcondition)
      const timestampsAfterSecondApply = await timestampSnapshot(db)
      if (
        secondApplyMutations !== 0 ||
        !valuesEqual(timestampsBeforeSecondApply, timestampsAfterSecondApply)
      ) {
        throw new Error('Second apply was not mutation- and timestamp-free')
      }
      const final = await inspectState(db)
      if (final.status !== 'COMPLETE') throw new Error('Final cleanup audit is not complete')
      return { initialStatus: prepared.status, mutations, secondApplyMutations }
    })

    const committed = await inspectState(connection as unknown as QuerySql)
    if (committed.status !== 'COMPLETE') throw new Error('Committed cleanup audit is not complete')
    console.log('[missing-demo-attachments] complete', {
      ...result,
      foreignKeyChecks: committed.foreignKeyChecks,
      textJsonReferences: committed.textJsonReferences,
      attachmentUuidReferences: committed.attachmentUuidReferences,
      fileLessonUuidReferences: committed.fileLessonUuidReferences,
    })
  } finally {
    connection.release()
  }
}

async function main(): Promise<void> {
  await assertCutoverDatabaseSession(sql)
  if (APPLY) await applyCleanup()
  else await auditOnly()
}

main()
  .catch((error: unknown) => {
    console.error(
      '[missing-demo-attachments] FAILED:',
      error instanceof Error ? error.message : error,
    )
    process.exitCode = 1
  })
  .finally(async () => {
    await sql.end({ timeout: 5 })
  })
