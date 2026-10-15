// The `training-skills` record saver: inline edits on a skill ticket (a
// person's skill assignment), queued on the device by the record page and
// applied by /api/records/sync (see lib/record-sync). Same rules the inline
// editors have always had — training module managers only, revoked tickets
// are read-only, an outcome needs a person and skill type, the person must be
// active and the skill type live, expiry never before the granted date, one
// audit entry per changed field, and skill-requirement compliance refreshed
// for the old and new skill type — plus a compare-and-set against the value
// the device last saw.
//
// Ops: the ticket's columns, and `extra:<definitionId>` for the employee
// inputs ("additional fields") its skill type or authority defines.

import { and, eq, isNull, sql } from 'drizzle-orm'
import { activePeopleWhere, type Database } from '@beaconhs/db'
import {
  people,
  trainingExtraFields,
  trainingSkillAssignments,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { canManageModule } from '@/lib/module-admin/guard'
import { isUuid } from '@/lib/list-params'
import { optionalTextInput } from '@/lib/mutation-input'
import type { RecordSyncPatch } from '@/lib/offline-drafts/protocol'
import {
  auditFieldChanges,
  defineRecordSaver,
  recordNotFound,
  recordOp,
  RecordSyncError,
  type ErasedRecordOp,
  type RecordSaver,
} from '@/lib/record-sync/edits'
import { TRAINING_EXTRA_FIELD_VALUE_MAX } from '../_lib/extra-field-policy'
import { settledPartnerDate } from '../_lib/record-date-order'
import { materializeSkillEvidence } from './_skill-evidence'
import {
  assertSkillAssignmentDateOrder,
  parseSkillAssignmentFieldUpdate,
  type SkillAssignmentFieldUpdate,
} from './_mutation-input'

type AssignmentRow = typeof trainingSkillAssignments.$inferSelect
type Field = SkillAssignmentFieldUpdate['field']
type FieldValue<F extends Field> = Extract<SkillAssignmentFieldUpdate, { field: F }>['value']

type Loaded = {
  row: AssignmentRow
  /** Person and skill type before this batch: a retarget refreshes both sides. */
  original: { personId: string | null; skillTypeId: string | null }
  /** Additional-field op → its field name, for the audit trail. */
  extraKeys: Map<string, string>
}

const FIELDS: readonly Field[] = [
  'personId',
  'skillTypeId',
  'grantedOn',
  'expiresOn',
  'status',
  'notes',
]

/** Changes to these refresh skill-requirement compliance. */
const EVIDENCE_FIELDS: ReadonlySet<string> = new Set([
  'personId',
  'skillTypeId',
  'grantedOn',
  'expiresOn',
  'status',
])

const EXTRA_PREFIX = 'extra:'

function isField(op: string): op is Field {
  return (FIELDS as readonly string[]).includes(op)
}

function parseField<F extends Field>(field: F, wire: unknown): FieldValue<F> {
  return parseSkillAssignmentFieldUpdate(field, wire).value as FieldValue<F>
}

const formatText = (value: string | null): string => value ?? ''

async function assertActivePerson(tx: Database, personId: string): Promise<void> {
  const [person] = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), activePeopleWhere()))
    .limit(1)
  if (!person) throw new Error('The selected person is not active in this workspace.')
}

async function assertActiveSkillType(tx: Database, skillTypeId: string): Promise<void> {
  const [skillType] = await tx
    .select({ id: trainingSkillTypes.id })
    .from(trainingSkillTypes)
    .where(
      and(
        eq(trainingSkillTypes.id, skillTypeId),
        eq(trainingSkillTypes.isActive, true),
        isNull(trainingSkillTypes.deletedAt),
      ),
    )
    .limit(1)
  if (!skillType) throw new Error('The selected skill type is not available in this workspace.')
}

function fieldOp(
  tx: Database,
  ctx: RequestContext,
  row: AssignmentRow,
  patches: readonly RecordSyncPatch[],
  field: Field,
): ErasedRecordOp {
  const partner = (other: 'grantedOn' | 'expiresOn') =>
    settledPartnerDate({
      patch: patches.find((patch) => patch.fieldId === other),
      current: row[other],
      parse: (wire) => parseField(other, wire),
    })
  return recordOp<string | null>({
    current: row[field],
    parse: async (wire) => {
      const value = parseField(field, wire)
      if (field === 'status' && value !== 'draft' && (!row.personId || !row.skillTypeId)) {
        throw new Error('Choose a person and skill type before setting an outcome.')
      }
      if (field === 'personId' && value !== row.personId) {
        await assertActivePerson(tx, value as string)
      }
      if (field === 'skillTypeId' && value !== row.skillTypeId) {
        await assertActiveSkillType(tx, value as string)
      }
      // Validate against the partner date as it will stand after this batch.
      if (field === 'grantedOn') {
        assertSkillAssignmentDateOrder(value as string, partner('expiresOn'))
      }
      if (field === 'expiresOn') {
        assertSkillAssignmentDateOrder(partner('grantedOn') ?? row.grantedOn, value)
      }
      return value
    },
    format: formatText,
    write: async (value) => {
      await tx
        .update(trainingSkillAssignments)
        .set({ [field]: value })
        .where(
          and(
            eq(trainingSkillAssignments.id, row.id),
            eq(trainingSkillAssignments.tenantId, ctx.tenantId),
            isNull(trainingSkillAssignments.deletedAt),
          ),
        )
      Object.assign(row, { [field]: value })
    },
  })
}

/** An additional field that cannot take a value right now (says why on save). */
function refusedExtraOp(current: string | null, message: string): ErasedRecordOp {
  return recordOp<string | null>({
    current,
    parse: () => {
      throw new Error(message)
    },
    format: formatText,
    write: async () => {},
  })
}

/**
 * An employee input on the ticket: a `record`-mode additional field defined on
 * the ticket's skill type or its authority. The value is stored on the
 * ticket's own row for that field name (matched case-insensitively).
 */
async function extraFieldOp(
  tx: Database,
  ctx: RequestContext,
  loaded: Loaded,
  op: string,
): Promise<ErasedRecordOp | null> {
  const definitionId = op.slice(EXTRA_PREFIX.length)
  if (!isUuid(definitionId)) return null
  const { row } = loaded
  const [definition] = await tx
    .select()
    .from(trainingExtraFields)
    .where(
      and(eq(trainingExtraFields.id, definitionId), eq(trainingExtraFields.tenantId, ctx.tenantId)),
    )
    .limit(1)
  if (!definition) return null
  loaded.extraKeys.set(op, definition.fieldKey)

  const answerWhere = and(
    eq(trainingExtraFields.tenantId, ctx.tenantId),
    eq(trainingExtraFields.skillAssignmentId, row.id),
    sql`lower(${trainingExtraFields.fieldKey}) = ${definition.fieldKey.toLowerCase()}`,
  )
  const [answer] = await tx
    .select({ id: trainingExtraFields.id, fieldValue: trainingExtraFields.fieldValue })
    .from(trainingExtraFields)
    .where(answerWhere)
    .limit(1)
    .for('update')
  const current = answer?.fieldValue ?? null

  if (!row.skillTypeId) {
    return refusedExtraOp(current, 'Choose a skill type before entering additional fields.')
  }
  const [type] = await tx
    .select({ id: trainingSkillTypes.id, authorityId: trainingSkillTypes.authorityId })
    .from(trainingSkillTypes)
    .where(
      and(
        eq(trainingSkillTypes.id, row.skillTypeId),
        eq(trainingSkillTypes.tenantId, ctx.tenantId),
      ),
    )
    .limit(1)
  if (!type) return refusedExtraOp(current, 'Skill type not found.')
  const belongsToType =
    definition.skillTypeId === type.id ||
    (definition.authorityId !== null && definition.authorityId === type.authorityId)
  if (definition.valueMode !== 'record' || !belongsToType) {
    return refusedExtraOp(
      current,
      'This field is not an employee input on the selected skill type.',
    )
  }

  let answerId = answer?.id ?? null
  return recordOp<string | null>({
    current,
    parse: (wire) => optionalTextInput(wire, 'Additional field', TRAINING_EXTRA_FIELD_VALUE_MAX),
    format: formatText,
    write: async (value) => {
      if (answerId) {
        await tx
          .update(trainingExtraFields)
          .set({ fieldValue: value })
          .where(
            and(
              eq(trainingExtraFields.id, answerId),
              eq(trainingExtraFields.tenantId, ctx.tenantId),
            ),
          )
      } else {
        const [inserted] = await tx
          .insert(trainingExtraFields)
          .values({
            tenantId: ctx.tenantId,
            skillAssignmentId: row.id,
            fieldKey: definition.fieldKey,
            fieldValue: value,
          })
          .returning({ id: trainingExtraFields.id })
        answerId = inserted?.id ?? null
      }
    },
  })
}

function skillAssignmentSpec(patches: readonly RecordSyncPatch[]) {
  return defineRecordSaver<Loaded>('training-skills', {
    authorize: (ctx) => canManageModule(ctx, 'training'),
    async load(tx, ctx, assignmentId) {
      const [row] = await tx
        .select()
        .from(trainingSkillAssignments)
        .where(
          and(
            eq(trainingSkillAssignments.id, assignmentId),
            eq(trainingSkillAssignments.tenantId, ctx.tenantId),
          ),
        )
        .limit(1)
        .for('update')
      if (!row) throw recordNotFound()
      // Revoking is permanent (a renewal mints a new ticket), so edits queued
      // on a device can never apply again.
      if (row.deletedAt) {
        throw new RecordSyncError('closed', 'Revoked skill assignments cannot be edited.')
      }
      return {
        row,
        original: { personId: row.personId, skillTypeId: row.skillTypeId },
        extraKeys: new Map(),
      }
    },
    resolve: (tx, ctx, loaded, op) => {
      if (isField(op)) return fieldOp(tx, ctx, loaded.row, patches, op)
      if (op.startsWith(EXTRA_PREFIX)) return extraFieldOp(tx, ctx, loaded, op)
      return null
    },
    async afterWrites(tx, ctx, { row, original, extraKeys }, changes) {
      await auditFieldChanges(
        tx,
        ctx,
        { entityType: 'training_skill', entityId: row.id },
        changes,
        (change) => {
          const fieldKey = extraKeys.get(change.op)
          return fieldKey
            ? { summary: `Updated ${fieldKey}`, key: 'value' }
            : { summary: `Updated ${change.op}` }
        },
      )
      if (changes.some((change) => EVIDENCE_FIELDS.has(change.op))) {
        await materializeSkillEvidence(tx, ctx.tenantId, [original.skillTypeId, row.skillTypeId])
      }
    },
    revalidate: (assignmentId, { row, original }) => [
      `/training/skills/${assignmentId}`,
      '/training/skills',
      ...new Set(
        [original.personId, row.personId]
          .filter((id): id is string => Boolean(id))
          .map((id) => `/people/${id}`),
      ),
      ...new Set(
        [original.skillTypeId, row.skillTypeId]
          .filter((id): id is string => Boolean(id))
          .map((id) => `/training/skills/types/${id}`),
      ),
    ],
  })
}

export const skillAssignmentRecordSaver: RecordSaver = (ctx, assignmentId, patches) =>
  skillAssignmentSpec(patches)(ctx, assignmentId, patches)
