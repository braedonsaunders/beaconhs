// The `training-skill-types` record saver: inline edits on a skill type,
// queued on the device by the skill-type page and applied by
// /api/records/sync (see lib/record-sync). Same rules the inline editor has
// always had — training module managers only, deleted types are gone, the
// same text limits and validity range, deactivating is refused while an
// active compliance obligation requires the type, credential outputs must be
// enabled designs, one audit entry per changed field — plus a compare-and-set
// against the value the device last saw.

import { and, eq, isNull } from 'drizzle-orm'
import { ComplianceTargetInUseError, assertComplianceTargetCanRetire } from '@beaconhs/compliance'
import type { Database } from '@beaconhs/db'
import { tenants, trainingSkillTypes } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { normalizeCredentialOutputs } from '@/lib/credential-designs'
import { canManageModule } from '@/lib/module-admin/guard'
import { optionalTextInput, requiredTextInput, requireEnumInput } from '@/lib/mutation-input'
import { columnOps, type Codec } from '@/lib/record-sync/codecs'
import {
  auditFieldChanges,
  defineRecordSaver,
  RecordEditRejection,
  recordNotFound,
  recordOp,
  type ErasedRecordOp,
} from '@/lib/record-sync/edits'
import {
  MAX_TRAINING_VALIDITY_MONTHS,
  optionalTrainingInteger,
} from '@/lib/training-mutation-validation'

type SkillTypeRow = typeof trainingSkillTypes.$inferSelect

const MAX_CREDENTIAL_OUTPUTS = 100
const VIEW_SOURCES = ['evidence', 'generated'] as const

const optionalText = (label: string, maxLength: number): Codec<string | null> => ({
  parse: (wire) => optionalTextInput(wire, label, maxLength),
  format: (value) => value ?? '',
})

const SKILL_TYPE_CODECS: { [K in keyof SkillTypeRow]?: Codec<SkillTypeRow[K]> } = {
  name: { parse: (wire) => requiredTextInput(wire, 'Name', 200), format: (value) => value },
  code: optionalText('Code', 120),
  description: optionalText('Description', 5000),
  validForMonths: {
    parse: (wire) => optionalTrainingInteger(wire, 'Validity months', MAX_TRAINING_VALIDITY_MONTHS),
    format: (value) => (value == null ? '' : String(value)),
  },
  viewSource: {
    parse: (wire) => requireEnumInput(wire, VIEW_SOURCES, 'View source'),
    format: (value) => value,
  },
}

/** Credential output ids as the page's checkbox list sends them. */
function parseCredentialOutputIds(wire: unknown, enabledIds: ReadonlySet<string>): string[] {
  if (
    !Array.isArray(wire) ||
    wire.some((value) => typeof value !== 'string') ||
    wire.length > MAX_CREDENTIAL_OUTPUTS
  ) {
    throw new Error('Invalid credential outputs.')
  }
  const ids = wire as string[]
  if (ids.some((value) => !enabledIds.has(value))) {
    throw new Error('Choose enabled credential designs.')
  }
  return [...new Set(ids)]
}

function updateSkillType(tx: Database, ctx: RequestContext, row: SkillTypeRow) {
  return (patch: Partial<SkillTypeRow>) =>
    tx
      .update(trainingSkillTypes)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(trainingSkillTypes.tenantId, ctx.tenantId), eq(trainingSkillTypes.id, row.id)))
}

function isActiveOp(tx: Database, ctx: RequestContext, row: SkillTypeRow): ErasedRecordOp {
  return recordOp<boolean>({
    current: row.isActive,
    parse: (wire) => requireEnumInput(wire, ['true', 'false'] as const, 'Active') === 'true',
    format: (value) => (value ? 'true' : 'false'),
    write: async (value) => {
      if (!value) {
        try {
          await assertComplianceTargetCanRetire(tx, ctx.tenantId, 'skill_type', row.id)
        } catch (error) {
          if (error instanceof ComplianceTargetInUseError) {
            throw new RecordEditRejection(error.message)
          }
          throw error
        }
      }
      await updateSkillType(tx, ctx, row)({ isActive: value })
      row.isActive = value
    },
  })
}

function credentialOutputsOp(tx: Database, ctx: RequestContext, row: SkillTypeRow): ErasedRecordOp {
  return recordOp<string[]>({
    current: row.credentialOutputIds,
    parse: async (wire) => {
      const [tenant] = await tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1)
      const enabled = new Set(
        normalizeCredentialOutputs(tenant?.settings)
          .filter((output) => output.enabled)
          .map((output) => output.id),
      )
      return parseCredentialOutputIds(wire, enabled)
    },
    format: (value) => value,
    write: async (value) => {
      await updateSkillType(tx, ctx, row)({ credentialOutputIds: value })
      row.credentialOutputIds = value
    },
  })
}

export const skillTypeRecordSaver = defineRecordSaver<SkillTypeRow>('training-skill-types', {
  authorize: (ctx) => canManageModule(ctx, 'training'),
  async load(tx, ctx, skillTypeId) {
    const [row] = await tx
      .select()
      .from(trainingSkillTypes)
      .where(
        and(
          eq(trainingSkillTypes.tenantId, ctx.tenantId),
          eq(trainingSkillTypes.id, skillTypeId),
          isNull(trainingSkillTypes.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!row) throw recordNotFound()
    return row
  },
  resolve: (tx, ctx, row, op) => {
    if (op === 'isActive') return isActiveOp(tx, ctx, row)
    if (op === 'credentialOutputIds') return credentialOutputsOp(tx, ctx, row)
    return columnOps(row, SKILL_TYPE_CODECS, updateSkillType(tx, ctx, row))(op)
  },
  afterWrites: (tx, ctx, row, changes) =>
    auditFieldChanges(tx, ctx, { entityType: 'training_skill_type', entityId: row.id }, changes),
  revalidate: (skillTypeId) => [
    '/training/skills/types',
    `/training/skills/types/${skillTypeId}`,
    '/training/skills',
  ],
})
