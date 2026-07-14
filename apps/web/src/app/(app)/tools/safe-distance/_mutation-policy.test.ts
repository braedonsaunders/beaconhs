import { describe, expect, it } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import { BUILTIN_ROLES } from '@beaconhs/db/schema'
import { canUseSafeDistance, SAFE_DISTANCE_PERMISSION } from '../../../../lib/safe-distance-access'
import { NAV_MODULES } from '../../../../lib/nav/registry'
import { FRONTLINE_ARTICLES } from '../../../../lib/manual/content/frontline'
import {
  evaluateSafeDistanceState,
  parseSafeDistanceIdentity,
  parseSafeDistanceSave,
} from './_mutation-policy'
import { MAX_SAFE_DISTANCE_SEGMENTS } from './_constraints'

const ID = '11111111-1111-4111-8111-111111111111'
const VERSION = '2026-07-12T12:00:00.000Z'

function validInput() {
  return {
    id: ID,
    version: VERSION,
    name: 'Hydrocarbon header',
    method: 'nasa' as const,
    unit: 'imperial' as const,
    testPressure: 150,
    description: 'Pressure test',
    siteOrgUnitId: null,
    supervisorTenantUserId: null,
    operatorPersonId: null,
    notes: null,
    segments: [{ name: 'Header', unit: 'inch' as const, lengthValue: 120, internalDiameter: 8 }],
  }
}

function context(permissions: string[] = [], isSuperAdmin = false): RequestContext {
  return {
    userId: 'user-1',
    tenantId: ID,
    isSuperAdmin,
    timezone: 'UTC',
    locale: 'en',
    defaultLocale: 'en',
    enabledLocales: ['en'],
    localeOverride: null,
    membership: null,
    personId: null,
    permissions: new Set(permissions),
    scopes: [],
    db: async () => {
      throw new Error('not used')
    },
  }
}

describe('Safe Distance permission policy', () => {
  it('requires the canonical capability and honors wildcard/super-admin access', () => {
    expect(canUseSafeDistance(context())).toBe(false)
    expect(canUseSafeDistance(context([SAFE_DISTANCE_PERMISSION]))).toBe(true)
    expect(canUseSafeDistance(context(['tools.*']))).toBe(true)
    expect(canUseSafeDistance(context([], true))).toBe(true)
  })

  it('keeps built-in roles, navigation, and the user guide on the same capability', () => {
    for (const role of Object.values(BUILTIN_ROLES)) {
      expect(role.permissions).toContain(SAFE_DISTANCE_PERMISSION)
    }
    expect(NAV_MODULES.find((module) => module.key === 'tools')?.requiredAnyPermission).toContain(
      SAFE_DISTANCE_PERMISSION,
    )
    expect(
      FRONTLINE_ARTICLES.find((article) => article.slug === 'safe-distance')?.requiredPermission,
    ).toBe(SAFE_DISTANCE_PERMISSION)
  })
})

describe('Safe Distance mutation validation', () => {
  it('normalizes a valid calculation and produces finite authoritative results', () => {
    const parsed = parseSafeDistanceSave(validInput())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.results.totalVolumeM3).toBeGreaterThan(0)
    expect(Number.isFinite(parsed.value.results.chosen)).toBe(true)
  })

  it('rejects invalid identities, foreign-key shapes, and stale-version shapes', () => {
    expect(parseSafeDistanceSave({ ...validInput(), id: 'not-a-uuid' }).ok).toBe(false)
    expect(parseSafeDistanceSave({ ...validInput(), siteOrgUnitId: 'not-a-uuid' }).ok).toBe(false)
    expect(parseSafeDistanceIdentity({ id: ID, version: 'yesterday' }).ok).toBe(false)
  })

  it('rejects unsafe numbers, missing pipes, and segment floods', () => {
    expect(
      parseSafeDistanceSave({ ...validInput(), testPressure: Number.POSITIVE_INFINITY }).ok,
    ).toBe(false)
    expect(parseSafeDistanceSave({ ...validInput(), segments: [] }).ok).toBe(false)
    expect(
      parseSafeDistanceSave({
        ...validInput(),
        segments: Array.from(
          { length: MAX_SAFE_DISTANCE_SEGMENTS + 1 },
          () => validInput().segments[0],
        ),
      }).ok,
    ).toBe(false)
    expect(
      parseSafeDistanceSave({
        ...validInput(),
        segments: [{ unit: 'm', lengthValue: 1_000_000, internalDiameter: 1_000_000 }],
      }).ok,
    ).toBe(false)
  })
})

describe('Safe Distance row-lock/version policy', () => {
  const row = { locked: false, updatedAt: new Date(VERSION) }

  it('allows a current save and rejects a stale unlocked overwrite', () => {
    expect(evaluateSafeDistanceState(row, VERSION, { kind: 'save' })).toEqual({
      ok: true,
      changed: true,
    })
    expect(
      evaluateSafeDistanceState(row, '2026-07-12T11:59:59.000Z', { kind: 'save' }),
    ).toMatchObject({ ok: false, reason: 'conflict' })
  })

  it('blocks saves and deletes after a concurrent lock', () => {
    const locked = { locked: true, updatedAt: new Date('2026-07-12T12:01:00.000Z') }
    expect(evaluateSafeDistanceState(locked, VERSION, { kind: 'save' })).toMatchObject({
      ok: false,
      reason: 'locked',
    })
    expect(evaluateSafeDistanceState(locked, VERSION, { kind: 'delete' })).toMatchObject({
      ok: false,
      reason: 'locked',
    })
  })

  it('makes duplicate lock requests no-ops and rejects a stale opposing transition', () => {
    const locked = { locked: true, updatedAt: new Date('2026-07-12T12:01:00.000Z') }
    expect(evaluateSafeDistanceState(locked, VERSION, { kind: 'set_lock', locked: true })).toEqual({
      ok: true,
      changed: false,
    })
    expect(
      evaluateSafeDistanceState(locked, VERSION, { kind: 'set_lock', locked: false }),
    ).toMatchObject({ ok: false, reason: 'conflict' })
  })
})
