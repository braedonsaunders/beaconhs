import { and, eq, inArray, or } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  trainingExtraFields,
  trainingSkillTypes,
  type ComplianceTargetRef,
} from '@beaconhs/db/schema'

export type SkillCondition = NonNullable<ComplianceTargetRef['skillConditions']>[number]
export type SkillField = Pick<
  typeof trainingExtraFields.$inferSelect,
  | 'id'
  | 'fieldKey'
  | 'fieldValue'
  | 'valueMode'
  | 'skillTypeId'
  | 'authorityId'
  | 'skillAssignmentId'
>

/** Same type-before-authority precedence used by the ticket editor. */
export function effectiveSkillFieldValue(
  definition: SkillField,
  fields: readonly SkillField[],
  typeId: string,
  ticketId: string,
): string | null {
  const key = definition.fieldKey.toLocaleLowerCase('en')
  const same = fields.filter((f) => f.fieldKey.toLocaleLowerCase('en') === key)
  const owner =
    same.find((f) => f.skillTypeId === typeId) ?? same.find((f) => f.authorityId !== null)
  if (!owner) return null
  return owner.valueMode === 'type'
    ? owner.fieldValue
    : (same.find((f) => f.skillAssignmentId === ticketId)?.fieldValue ?? null)
}

export function skillFieldMatches(value: string | null, condition: SkillCondition): boolean {
  if (!value?.trim() || !condition.values.length) return false
  const normalize = (v: string) => v.trim().normalize('NFKC').toLocaleLowerCase('en')
  const required = condition.values.map(normalize)
  if (condition.operator === 'equals')
    return required.length === 1 && normalize(value) === required[0]
  const tokens = new Set(
    value
      .split(/[,/;|]+/u)
      .map(normalize)
      .filter(Boolean),
  )
  return condition.operator === 'contains_all'
    ? required.every((v) => tokens.has(v))
    : required.some((v) => tokens.has(v))
}

export async function loadSkillConditionFields(
  tx: Database,
  tenantId: string,
  typeId: string,
  ticketIds: string[] = [],
): Promise<SkillField[]> {
  const [type] = await tx
    .select({ authorityId: trainingSkillTypes.authorityId })
    .from(trainingSkillTypes)
    .where(and(eq(trainingSkillTypes.tenantId, tenantId), eq(trainingSkillTypes.id, typeId)))
    .limit(1)
  if (!type) return []
  return tx
    .select({
      id: trainingExtraFields.id,
      fieldKey: trainingExtraFields.fieldKey,
      fieldValue: trainingExtraFields.fieldValue,
      valueMode: trainingExtraFields.valueMode,
      skillTypeId: trainingExtraFields.skillTypeId,
      authorityId: trainingExtraFields.authorityId,
      skillAssignmentId: trainingExtraFields.skillAssignmentId,
    })
    .from(trainingExtraFields)
    .where(
      and(
        eq(trainingExtraFields.tenantId, tenantId),
        or(
          eq(trainingExtraFields.skillTypeId, typeId),
          eq(trainingExtraFields.authorityId, type.authorityId),
          ticketIds.length ? inArray(trainingExtraFields.skillAssignmentId, ticketIds) : undefined,
        ),
      ),
    )
}

export async function validateSkillConditions(
  tx: Database,
  tenantId: string,
  ref: ComplianceTargetRef,
): Promise<void> {
  if (!ref.skillConditions?.length) return
  if (!ref.skillTypeId)
    throw new Error('Choose a skill type before adding qualification conditions')
  const fields = await loadSkillConditionFields(tx, tenantId, ref.skillTypeId)
  for (const condition of ref.skillConditions) {
    const field = fields.find((f) => f.id === condition.fieldId && !f.skillAssignmentId)
    if (
      !field ||
      !['equals', 'contains_all', 'contains_any'].includes(condition.operator) ||
      !condition.values.length ||
      condition.values.some((v) => !v.trim()) ||
      (condition.operator === 'equals' && condition.values.length !== 1)
    )
      throw new Error('Choose a valid additional field, comparison and value for this skill type')
  }
  // Lock definitions so a concurrent deletion cannot orphan newly saved conditions.
  const locked = await tx
    .select({ id: trainingExtraFields.id })
    .from(trainingExtraFields)
    .where(
      and(
        eq(trainingExtraFields.tenantId, tenantId),
        inArray(
          trainingExtraFields.id,
          ref.skillConditions.map((c) => c.fieldId),
        ),
      ),
    )
    .for('key share')
  if (locked.length !== new Set(ref.skillConditions.map((condition) => condition.fieldId)).size)
    throw new Error('Choose a valid additional field, comparison and value for this skill type')
}
