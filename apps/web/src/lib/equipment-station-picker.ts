import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { primaryPersonTitleName, type Database } from '@beaconhs/db'
import { orgUnits, people } from '@beaconhs/db/schema'
import {
  boundPickerOptions,
  PICKER_RESULT_LIMIT,
  type PickerOptionsResponse,
} from './picker-options'
import { isUuid } from './list-params'

const EQUIPMENT_STATION_PICKER_QUERY_LIMIT = 100
const EQUIPMENT_STATION_PICKER_KINDS = ['holder', 'location'] as const

type EquipmentStationPickerKind = (typeof EQUIPMENT_STATION_PICKER_KINDS)[number]
type EquipmentStationPickerSearchInput = {
  query: string
  selected: string | null
}

type EquipmentStationPickerQuery = {
  term: string | null
  selected: string | null
}

function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`)
}

function recordInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Station picker request is invalid.')
  }
  return value as Record<string, unknown>
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allow = new Set(allowed)
  if (Object.keys(value).some((key) => !allow.has(key))) {
    throw new Error('Station picker request is invalid.')
  }
}

export function parseEquipmentStationPickerSearchInput(
  value: unknown,
): EquipmentStationPickerSearchInput {
  const record = recordInput(value)
  assertExactKeys(record, ['query', 'selected'])
  if (typeof record.query !== 'string') throw new Error('Station picker search is invalid.')
  if (record.query.length > EQUIPMENT_STATION_PICKER_QUERY_LIMIT) {
    throw new Error(
      `Station picker search must be ${EQUIPMENT_STATION_PICKER_QUERY_LIMIT} characters or less.`,
    )
  }
  if (/[\u0000-\u001f\u007f]/.test(record.query)) {
    throw new Error('Station picker search is invalid.')
  }
  const query = record.query.trim()
  const selected = record.selected == null || record.selected === '' ? null : record.selected
  if (selected !== null && (typeof selected !== 'string' || !isUuid(selected))) {
    throw new Error('Selected station option is invalid.')
  }
  return { query, selected: selected?.toLowerCase() ?? null }
}

export function equipmentStationPickerKind(value: unknown): EquipmentStationPickerKind | null {
  return typeof value === 'string' &&
    (EQUIPMENT_STATION_PICKER_KINDS as readonly string[]).includes(value)
    ? (value as EquipmentStationPickerKind)
    : null
}

export function equipmentStationPickerQuery(
  value: EquipmentStationPickerSearchInput,
): EquipmentStationPickerQuery {
  return {
    term: value.query ? `%${escapeIlike(value.query)}%` : null,
    selected: value.selected,
  }
}

function clean(value: string, max: number): string {
  return value.trim().slice(0, max)
}

export async function loadEquipmentStationPickerOptions(
  tx: Database,
  tenantId: string,
  kind: EquipmentStationPickerKind,
  input: EquipmentStationPickerQuery,
): Promise<PickerOptionsResponse> {
  if (kind === 'holder') {
    const match = input.term
      ? or(
          ilike(people.firstName, input.term),
          ilike(people.lastName, input.term),
          ilike(people.employeeNo, input.term),
          ilike(primaryPersonTitleName(people.id, people.tenantId), input.term),
          ilike(sql<string>`(${people.firstName} || ' ' || ${people.lastName})`, input.term),
          input.selected ? eq(people.id, input.selected) : undefined,
        )
      : undefined
    const rows = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
        jobTitle: primaryPersonTitleName(people.id, people.tenantId),
      })
      .from(people)
      .where(
        and(
          eq(people.tenantId, tenantId),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
          match,
        ),
      )
      .orderBy(
        ...(input.selected ? [desc(sql`${people.id} = ${input.selected}`)] : []),
        asc(people.lastName),
        asc(people.firstName),
        asc(people.id),
      )
      .limit(PICKER_RESULT_LIMIT + 1)
    return boundPickerOptions(
      rows.map((row) => ({
        value: row.id,
        label: clean(`${row.lastName}, ${row.firstName}`, 240),
        ...([row.employeeNo, row.jobTitle].filter(Boolean).length > 0
          ? { hint: clean([row.employeeNo, row.jobTitle].filter(Boolean).join(' · '), 120) }
          : {}),
      })),
    )
  }

  const match = input.term
    ? or(
        ilike(orgUnits.name, input.term),
        ilike(orgUnits.code, input.term),
        input.selected ? eq(orgUnits.id, input.selected) : undefined,
      )
    : undefined
  const rows = await tx
    .select({
      id: orgUnits.id,
      name: orgUnits.name,
      code: orgUnits.code,
      level: orgUnits.level,
      isBase: orgUnits.isEquipmentBase,
    })
    .from(orgUnits)
    .where(and(eq(orgUnits.tenantId, tenantId), isNull(orgUnits.deletedAt), match))
    .orderBy(
      ...(input.selected ? [desc(sql`${orgUnits.id} = ${input.selected}`)] : []),
      desc(orgUnits.isEquipmentBase),
      asc(orgUnits.name),
      asc(orgUnits.id),
    )
    .limit(PICKER_RESULT_LIMIT + 1)
  return boundPickerOptions(
    rows.map((row) => ({
      value: row.id,
      label: clean(row.name, 240),
      hint: clean(
        [row.isBase ? 'base' : null, row.level, row.code].filter(Boolean).join(' · '),
        120,
      ),
    })),
  )
}
