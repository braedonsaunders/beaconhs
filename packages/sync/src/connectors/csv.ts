// CSV / spreadsheet connector (native). One connection targets one entity;
// columns are auto-matched to canonical fields by header name, with an optional
// explicit mapping override. No credentials — fully self-contained.

import { createHash } from 'node:crypto'
import { parseCsv } from '../csv'
import type { CanonicalRecord, Connector, ConnectorRunContext, SyncEntityKey } from '../types'

type CsvConfig = {
  entity?: SyncEntityKey
  csv?: string
  delimiter?: string
  mapping?: Record<string, string>
  idColumn?: string
}

const PEOPLE_ALIASES: Record<string, string[]> = {
  firstName: ['firstname', 'first', 'givenname', 'fname'],
  lastName: ['lastname', 'last', 'surname', 'familyname', 'lname'],
  employeeNo: ['employeeno', 'employeenumber', 'empno', 'employeeid', 'payrollid', 'badge'],
  externalEmployeeId: [
    'externalemployeeid',
    'externalempid',
    'sourceemployeeid',
    'employeeinternalid',
  ],
  email: ['email', 'emailaddress', 'workemail'],
  phone: ['phone', 'mobile', 'telephone', 'cell'],
  jobTitle: ['jobtitle', 'title', 'position', 'role'],
  departmentName: ['department', 'dept'],
  tradeName: ['trade', 'craft', 'classification'],
  hireDate: ['hiredate', 'startdate', 'datehired'],
}

const ORG_ALIASES: Record<string, string[]> = {
  name: ['name', 'sitename', 'locationname', 'location', 'projectname', 'project', 'customername'],
  code: ['code', 'sitecode', 'number', 'locationcode', 'jobnumber', 'projectcode'],
  level: ['level', 'type', 'tier'],
  parentCode: ['parentcode', 'parent', 'parentid'],
}

const EQUIP_ALIASES: Record<string, string[]> = {
  name: ['name', 'description', 'equipmentname', 'assetname', 'model'],
  assetTag: ['assettag', 'tag', 'assetid', 'asset', 'assetnumber', 'number', 'unit', 'unitnumber'],
  serialNumber: ['serial', 'serialnumber', 'sn'],
  typeName: ['type', 'category', 'equipmenttype', 'class'],
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function resolveHeaders(
  headers: string[],
  aliases: Record<string, string[]>,
  override?: Record<string, string>,
): Record<string, string | undefined> {
  const byNorm = new Map<string, string>()
  for (const h of headers) byNorm.set(norm(h), h)
  const out: Record<string, string | undefined> = {}
  for (const field of Object.keys(aliases)) {
    const ov = override?.[field]
    if (ov && headers.includes(ov)) {
      out[field] = ov
      continue
    }
    for (const a of aliases[field] ?? []) {
      const h = byNorm.get(norm(a))
      if (h) {
        out[field] = h
        break
      }
    }
  }
  return out
}

function normDate(v: string | null): string | null {
  if (!v) return null
  const s = v.trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (mdy) return `${mdy[3]}-${(mdy[1] ?? '').padStart(2, '0')}-${(mdy[2] ?? '').padStart(2, '0')}`
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

function normLevel(v: string | null): 'customer' | 'project' | 'site' | 'area' | undefined {
  if (!v) return undefined
  const s = v.toLowerCase()
  if (s.startsWith('cust')) return 'customer'
  if (s.startsWith('proj') || s.startsWith('job')) return 'project'
  if (s.startsWith('area') || s.startsWith('zone')) return 'area'
  if (s.startsWith('site') || s.startsWith('loc')) return 'site'
  return undefined
}

function hashRow(o: unknown): string {
  return createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16)
}

export const csvConnector: Connector = {
  key: 'csv',
  name: 'CSV / Spreadsheet',
  description:
    'Paste or upload a CSV of people, locations or equipment. Columns are auto-matched to fields; re-importing updates existing records.',
  kind: 'native',
  iconKey: 'file-spreadsheet',
  entities: ['people', 'org_unit', 'equipment'],
  async pull(ctx: ConnectorRunContext): Promise<CanonicalRecord[]> {
    const cfg = ctx.config as CsvConfig
    const entity = cfg.entity
    if (!entity) {
      ctx.log('warn', 'No target entity selected for the CSV connection.')
      return []
    }
    const { headers, rows } = parseCsv(cfg.csv ?? '', cfg.delimiter || ',')
    if (rows.length === 0) {
      ctx.log('warn', 'CSV has no data rows.')
      return []
    }
    const aliases =
      entity === 'people'
        ? PEOPLE_ALIASES
        : entity === 'org_unit'
          ? ORG_ALIASES
          : EQUIP_ALIASES
    const map = resolveHeaders(headers, aliases, cfg.mapping)
    ctx.log(
      'info',
      `Mapped: ${
        Object.entries(map)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}←${v}`)
          .join(', ') || '(no columns matched)'
      }`,
    )
    const idCol = cfg.idColumn && headers.includes(cfg.idColumn) ? cfg.idColumn : null
    const get = (row: Record<string, string>, field: string): string | null => {
      const h = map[field]
      if (!h) return null
      const v = (row[h] ?? '').trim()
      return v === '' ? null : v
    }

    const out: CanonicalRecord[] = []
    for (const row of rows) {
      const idRaw = idCol ? (row[idCol] ?? '').trim() || null : null
      switch (entity) {
        case 'people': {
          const data = {
            firstName: get(row, 'firstName') ?? '',
            lastName: get(row, 'lastName') ?? '',
            employeeNo: get(row, 'employeeNo'),
            externalEmployeeId: get(row, 'externalEmployeeId'),
            email: get(row, 'email'),
            phone: get(row, 'phone'),
            jobTitle: get(row, 'jobTitle'),
            departmentName: get(row, 'departmentName'),
            tradeName: get(row, 'tradeName'),
            hireDate: normDate(get(row, 'hireDate')),
          }
          out.push({ entity: 'people', externalId: idRaw || data.employeeNo || hashRow(row), data })
          break
        }
        case 'org_unit': {
          const data = {
            name: get(row, 'name') ?? '',
            code: get(row, 'code'),
            level: normLevel(get(row, 'level')),
            parentCode: get(row, 'parentCode'),
          }
          out.push({ entity: 'org_unit', externalId: idRaw || data.code || hashRow(row), data })
          break
        }
        case 'equipment': {
          const data = {
            name: get(row, 'name') ?? get(row, 'assetTag') ?? '',
            assetTag: get(row, 'assetTag') ?? '',
            serialNumber: get(row, 'serialNumber'),
            typeName: get(row, 'typeName'),
          }
          out.push({
            entity: 'equipment',
            externalId: idRaw || data.assetTag || hashRow(row),
            data,
          })
          break
        }
      }
    }
    return out
  },
}
