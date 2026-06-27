// Shared (server-side) helpers for role-assignment data scopes: load the
// ACTIVE-only option lists the ScopePicker needs, and summarise a stored
// RoleScope into human text for the assignment list. Not a 'use server' module —
// these are plain async helpers imported by the admin server components.

import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  crews,
  departments,
  orgUnits,
  people,
  personGroups,
  type RoleScope,
} from '@beaconhs/db/schema'
import type { requireRequestContext } from '@/lib/auth'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>
export type ScopeOpt = { value: string; label: string; hint?: string }
export type ScopeOptions = {
  sites: ScopeOpt[]
  crews: ScopeOpt[]
  departments: ScopeOpt[]
  groups: ScopeOpt[]
  people: ScopeOpt[]
}

function strArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []
}

/** Validate + normalise a serialized RoleScope from the ScopePicker. */
export function parseRoleScope(raw: string): RoleScope {
  try {
    const v = JSON.parse(raw) as { type?: string } & Record<string, unknown>
    switch (v?.type) {
      case 'tenant':
        return { type: 'tenant' }
      case 'self':
        return { type: 'self' }
      case 'sites':
        return { type: 'sites', siteIds: strArray(v.siteIds) }
      case 'crews':
        return { type: 'crews', crewIds: strArray(v.crewIds) }
      case 'people':
        return { type: 'people', personIds: strArray(v.personIds) }
      case 'team':
        return {
          type: 'team',
          // Accept the legacy `divisionIds` key on any not-yet-migrated stored scope.
          departmentIds: strArray(v.departmentIds ?? v.divisionIds),
          groupIds: strArray(v.groupIds),
        }
    }
  } catch {
    // fall through
  }
  return { type: 'self' }
}

export async function loadScopeOptions(ctx: Ctx): Promise<ScopeOptions> {
  return ctx.db(async (tx) => {
    const sites = await tx
      .select({ value: orgUnits.id, label: orgUnits.name })
      .from(orgUnits)
      .where(and(eq(orgUnits.level, 'site'), isNull(orgUnits.deletedAt)))
      .orderBy(asc(orgUnits.name))
    const crewRows = await tx
      .select({ value: crews.id, label: crews.name })
      .from(crews)
      .orderBy(asc(crews.name))
    const departmentOpts = await tx
      .select({ value: departments.id, label: departments.name })
      .from(departments)
      .orderBy(asc(departments.name))
    const groups = await tx
      .select({ value: personGroups.id, label: personGroups.name })
      .from(personGroups)
      .orderBy(asc(personGroups.name))
    const peopleRows = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
      .orderBy(asc(people.lastName), asc(people.firstName))
    return {
      sites,
      crews: crewRows,
      departments: departmentOpts,
      groups,
      people: peopleRows.map((p) => ({
        value: p.id,
        label: `${p.lastName}, ${p.firstName}`,
        hint: p.employeeNo ?? undefined,
      })),
    }
  })
}

function names(ids: string[], opts: ScopeOpt[]): string {
  if (ids.length === 0) return 'none'
  return ids.map((id) => opts.find((o) => o.value === id)?.label ?? '—').join(', ')
}

/** One-line summary of a stored scope, resolving ids to names. */
export function describeScope(scope: RoleScope, opts: ScopeOptions): string {
  switch (scope.type) {
    case 'tenant':
      return 'Everyone in the tenant'
    case 'self':
      return 'Own records only'
    case 'sites':
      return `Sites — ${names(scope.siteIds, opts.sites)}`
    case 'crews':
      return `Crews — ${names(scope.crewIds, opts.crews)}`
    case 'people':
      return `People — ${names(scope.personIds, opts.people)}`
    case 'team': {
      const parts: string[] = []
      if (scope.departmentIds.length)
        parts.push(`departments: ${names(scope.departmentIds, opts.departments)}`)
      if (scope.groupIds.length) parts.push(`groups: ${names(scope.groupIds, opts.groups)}`)
      return `Department — ${parts.length ? parts.join('; ') : 'none'}`
    }
    default:
      return 'Custom'
  }
}
