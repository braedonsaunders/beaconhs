import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  complianceAudience,
  complianceObligations,
  departments,
  orgUnits,
  people,
  roles,
  trades,
} from '@beaconhs/db/schema'

export type PersistedComplianceAudienceKind =
  'everyone' | 'person' | 'role' | 'trade' | 'department' | 'org_unit'

export type ComplianceAudienceTarget = {
  kind: PersistedComplianceAudienceKind
  entityKey: string
}

export class ComplianceAudienceTargetError extends Error {
  override readonly name = 'ComplianceAudienceTargetError'
}

export type RetirableComplianceAudienceTarget = Pick<ComplianceAudienceTarget, 'entityKey'> & {
  kind: 'role' | 'trade' | 'department'
}

type TargetLockPlan = Record<PersistedComplianceAudienceKind, string[]>

const TARGET_KIND_ORDER: readonly PersistedComplianceAudienceKind[] = [
  'everyone',
  'person',
  'role',
  'trade',
  'department',
  'org_unit',
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/**
 * Normalise an authored audience before locking it. Keeping this pure makes the
 * deadlock-prevention contract directly testable: every transaction visits the
 * same kind order and the same lexical key order, regardless of form order.
 */
export function planComplianceAudienceTargetLocks(
  audience: readonly ComplianceAudienceTarget[],
): TargetLockPlan {
  const byKind = Object.fromEntries(
    TARGET_KIND_ORDER.map((kind) => [kind, new Set<string>()]),
  ) as Record<PersistedComplianceAudienceKind, Set<string>>

  for (const target of audience) {
    const entityKey = target.entityKey.trim()
    if (target.kind === 'everyone') {
      if (entityKey !== '' && entityKey !== 'all') {
        throw new ComplianceAudienceTargetError('The everyone audience must not have an entity key')
      }
      byKind.everyone.add('')
      continue
    }
    if (!entityKey) {
      throw new ComplianceAudienceTargetError(`The ${target.kind} audience is missing its target`)
    }
    if (target.kind !== 'role' && !UUID.test(entityKey)) {
      throw new ComplianceAudienceTargetError(
        `The ${target.kind.replace('_', ' ')} audience target is invalid`,
      )
    }
    byKind[target.kind].add(entityKey)
  }

  return Object.fromEntries(
    TARGET_KIND_ORDER.map((kind) => [kind, [...byKind[kind]].sort((a, b) => a.localeCompare(b))]),
  ) as TargetLockPlan
}

async function requireLockedTarget(
  load: () => Promise<{ id: string } | undefined>,
  label: string,
): Promise<void> {
  if (!(await load())) {
    throw new ComplianceAudienceTargetError(`The selected ${label} is no longer available`)
  }
}

/**
 * Validate and pin every polymorphic compliance-audience target in the caller's
 * transaction. Catalog deletion takes FOR UPDATE on the same row before its
 * reference check; these FOR KEY SHARE locks therefore close the create/delete
 * race that a check against `compliance_audience` alone cannot prevent.
 *
 * Targets are deliberately locked one-by-one in deterministic order. Audience
 * sets are small, and deterministic lock acquisition is more important than
 * saving a handful of local database round trips in an administrative flow.
 */
export async function lockComplianceAudienceTargets(
  tx: Database,
  tenantId: string,
  audience: readonly ComplianceAudienceTarget[],
): Promise<void> {
  const plan = planComplianceAudienceTargetLocks(audience)

  for (const id of plan.person) {
    await requireLockedTarget(async () => {
      const [row] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.tenantId, tenantId), eq(people.id, id), isNull(people.deletedAt)))
        .limit(1)
        .for('key share')
      return row
    }, 'person')
  }
  for (const key of plan.role) {
    await requireLockedTarget(async () => {
      const [row] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)))
        .limit(1)
        .for('key share')
      return row
    }, 'role')
  }
  for (const id of plan.trade) {
    await requireLockedTarget(async () => {
      const [row] = await tx
        .select({ id: trades.id })
        .from(trades)
        .where(and(eq(trades.tenantId, tenantId), eq(trades.id, id)))
        .limit(1)
        .for('key share')
      return row
    }, 'trade')
  }
  for (const id of plan.department) {
    await requireLockedTarget(async () => {
      const [row] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.tenantId, tenantId), eq(departments.id, id)))
        .limit(1)
        .for('key share')
      return row
    }, 'department')
  }
  for (const id of plan.org_unit) {
    await requireLockedTarget(async () => {
      const [row] = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(
          and(eq(orgUnits.tenantId, tenantId), eq(orgUnits.id, id), isNull(orgUnits.deletedAt)),
        )
        .limit(1)
        .for('key share')
      return row
    }, 'organization unit')
  }
}

/**
 * Count live obligations that still reference a polymorphic audience target.
 * The caller must first lock the target owner row FOR UPDATE. Obligation
 * authoring takes FOR KEY SHARE on that same row before inserting or replacing
 * an audience, so the owner-first protocol closes the create/delete race.
 *
 * Soft-deleted obligations are historical and do not block retirement. Every
 * other persisted state does: paused requirements can be enabled again, while
 * an imported archived requirement may be reactivated by its authoritative
 * source on the next synchronization.
 */
export async function countComplianceAudienceTargetUses(
  tx: Database,
  tenantId: string,
  target: RetirableComplianceAudienceTarget,
): Promise<number> {
  const rows = await tx
    .selectDistinct({ id: complianceObligations.id })
    .from(complianceAudience)
    .innerJoin(
      complianceObligations,
      and(
        eq(complianceObligations.tenantId, complianceAudience.tenantId),
        eq(complianceObligations.id, complianceAudience.obligationId),
      ),
    )
    .where(
      and(
        eq(complianceAudience.tenantId, tenantId),
        eq(complianceAudience.kind, target.kind),
        eq(complianceAudience.entityKey, target.entityKey),
        isNull(complianceObligations.deletedAt),
      ),
    )
  return rows.length
}
