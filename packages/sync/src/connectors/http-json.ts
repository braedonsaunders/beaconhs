import type {
  CanonicalEquipment,
  CanonicalRecord,
  Connector,
  ConnectorRunContext,
  SyncEntityKey,
} from '../types'
import {
  datePart,
  fieldFromPath,
  getPath,
  hashRow,
  numPart,
  orgLevel,
  renderTemplate,
  splitName,
  type SourceRow,
} from '../transform'

type HttpMethod = 'GET' | 'POST'

type HttpJsonConfig = {
  url?: string
  method?: HttpMethod
  entity?: SyncEntityKey
  recordsPath?: string
  idPath?: string
  externalIdTemplate?: string
  mappingJson?: string
  headersJson?: string
  bodyTemplate?: string
  apiKeyHeader?: string
  cursorParam?: string
  nextCursorPath?: string
  pageSizeParam?: string
  pageSize?: number
  maxPages?: number
}

type Mapping = {
  columns?: Record<string, string>
  values?: Record<string, string>
}

function parseJsonObject(raw: string | undefined, label: string): Record<string, unknown> {
  if (!raw?.trim()) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function parseMapping(raw: string | undefined): Mapping {
  if (!raw?.trim()) return { columns: {}, values: {} }
  const parsed = parseJsonObject(raw, 'Mapping JSON')
  return {
    columns:
      parsed.columns && typeof parsed.columns === 'object' && !Array.isArray(parsed.columns)
        ? (parsed.columns as Record<string, string>)
        : {},
    values:
      parsed.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values)
        ? (parsed.values as Record<string, string>)
        : {},
  }
}

function rowsAt(payload: unknown, path: string | undefined): SourceRow[] {
  const value = path?.trim() ? getPath(payload, path.trim()) : payload
  if (!Array.isArray(value)) throw new Error('Response records path did not resolve to an array.')
  return value.filter((row): row is SourceRow => Boolean(row && typeof row === 'object'))
}

function field(row: SourceRow, mapping: Mapping, key: string): string | null {
  const template = mapping.values?.[key]
  if (template != null) {
    const rendered = renderTemplate(String(template), row).trim()
    return rendered === '' ? null : rendered
  }
  return fieldFromPath(row, mapping.columns?.[key])
}

function status(v: string | null): 'active' | 'inactive' | 'terminated' | undefined {
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
  if (['active', 'inactive', 'terminated'].includes(s)) {
    return s as 'active' | 'inactive' | 'terminated'
  }
  return undefined
}

function equipmentStatus(v: string | null): CanonicalEquipment['status'] | undefined {
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
  if (['in_service', 'out_of_service', 'in_repair', 'lost', 'retired'].includes(s)) {
    return s as CanonicalEquipment['status']
  }
  if (s === 'active') return 'in_service'
  if (s === 'inactive') return 'out_of_service'
  return undefined
}

function externalId(
  row: SourceRow,
  cfg: HttpJsonConfig,
  mapping: Mapping,
  fallback: string,
): string {
  if (cfg.externalIdTemplate?.trim()) {
    const rendered = renderTemplate(cfg.externalIdTemplate, row).trim()
    if (rendered) return rendered
  }
  const direct = fieldFromPath(row, cfg.idPath)
  if (direct) return direct
  const mapped = field(row, mapping, 'externalId')
  return mapped || fallback
}

function mapRow(
  entity: SyncEntityKey,
  cfg: HttpJsonConfig,
  mapping: Mapping,
  row: SourceRow,
): CanonicalRecord | null {
  const g = (key: string) => field(row, mapping, key)
  switch (entity) {
    case 'people': {
      const fullName = g('fullName')
      const parsed = splitName(fullName)
      const data = {
        fullName,
        firstName: g('firstName') ?? parsed.first,
        lastName: g('lastName') ?? parsed.last,
        employeeNo: g('employeeNo'),
        externalEmployeeId: g('externalEmployeeId'),
        email: g('email'),
        phone: g('phone'),
        jobTitle: g('jobTitle'),
        departmentName: g('departmentName'),
        tradeName: g('tradeName'),
        hireDate: datePart(g('hireDate')),
        status: status(g('status')),
        metadata: { source: row },
      }
      if (!data.firstName && !data.lastName) return null
      return {
        entity: 'people',
        externalId: externalId(
          row,
          cfg,
          mapping,
          data.externalEmployeeId || data.employeeNo || hashRow(row),
        ),
        data,
      }
    }
    case 'org_unit': {
      const address = {
        line1: g('addressLine1') ?? undefined,
        line2: g('addressLine2') ?? undefined,
        city: g('addressCity') ?? undefined,
        region: g('addressRegion') ?? undefined,
        postal: g('addressPostal') ?? undefined,
        country: g('addressCountry') ?? undefined,
      }
      const data = {
        name: g('name') ?? '',
        code: g('code'),
        parentCode: g('parentCode'),
        level: orgLevel(g('level')),
        lat: numPart(g('lat')),
        lng: numPart(g('lng')),
        geofenceMeters: numPart(g('geofenceMeters')),
        address: Object.values(address).some(Boolean) ? address : null,
        metadata: { source: row },
      }
      if (!data.name) return null
      return {
        entity: 'org_unit',
        externalId: externalId(row, cfg, mapping, data.code || hashRow(row)),
        data,
      }
    }
    case 'equipment': {
      const data = {
        name: g('name') ?? g('assetTag') ?? '',
        assetTag: g('assetTag') ?? '',
        serialNumber: g('serialNumber'),
        description: g('description'),
        typeName: g('typeName'),
        status: equipmentStatus(g('status')),
        metadata: { source: row },
      }
      if (!data.assetTag) return null
      return {
        entity: 'equipment',
        externalId: externalId(row, cfg, mapping, data.assetTag || hashRow(row)),
        data,
      }
    }
  }
}

function cursorText(value: unknown): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

async function fetchJson(
  cfg: HttpJsonConfig,
  ctx: ConnectorRunContext,
  cursor: string | null,
): Promise<unknown> {
  if (!cfg.url?.trim()) throw new Error('HTTP JSON connector requires a URL.')
  const url = new URL(cfg.url)
  if (cfg.cursorParam?.trim() && cursor) url.searchParams.set(cfg.cursorParam.trim(), cursor)
  if (cfg.pageSizeParam?.trim() && cfg.pageSize) {
    url.searchParams.set(cfg.pageSizeParam.trim(), String(cfg.pageSize))
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...parseJsonObject(cfg.headersJson, 'Headers JSON'),
  } as Record<string, string>
  if (ctx.secrets.bearerToken) headers.Authorization = `Bearer ${ctx.secrets.bearerToken}`
  if (ctx.secrets.apiKey && cfg.apiKeyHeader?.trim())
    headers[cfg.apiKeyHeader.trim()] = ctx.secrets.apiKey

  const method = (cfg.method ?? 'GET').toUpperCase() as HttpMethod
  const body =
    method === 'POST' && cfg.bodyTemplate?.trim()
      ? renderTemplate(cfg.bodyTemplate, { cursor: cursor ?? '' })
      : undefined
  if (body) headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'

  const res = await fetch(url, { method, headers, body })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

export const httpJsonConnector: Connector = {
  key: 'http_json',
  name: 'HTTP / JSON API',
  description:
    'Pull People, Locations & Projects, or Equipment from any JSON API using path-based field mapping, headers, bearer tokens, API keys, and optional cursor pagination.',
  kind: 'native',
  iconKey: 'plug-zap',
  entities: ['people', 'org_unit', 'equipment'],
  configFields: [
    {
      key: 'url',
      label: 'Endpoint URL',
      type: 'text',
      required: true,
      placeholder: 'https://api.example.com/workers',
    },
    {
      key: 'method',
      label: 'Method',
      type: 'select',
      options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
      ],
    },
    {
      key: 'entity',
      label: 'Import as',
      type: 'select',
      required: true,
      options: [
        { value: 'people', label: 'People' },
        { value: 'org_unit', label: 'Locations & Projects' },
        { value: 'equipment', label: 'Equipment' },
      ],
    },
    { key: 'recordsPath', label: 'Records path', type: 'text', placeholder: 'data.items' },
    { key: 'idPath', label: 'ID path', type: 'text', placeholder: 'id' },
    {
      key: 'externalIdTemplate',
      label: 'External ID template',
      type: 'text',
      placeholder: 'api:{{id}}',
    },
    {
      key: 'mappingJson',
      label: 'Field mapping JSON',
      type: 'textarea',
      help: 'Object with columns and/or values. Example: {"columns":{"firstName":"person.first","lastName":"person.last","externalEmployeeId":"id"}}',
    },
    { key: 'headersJson', label: 'Headers JSON', type: 'textarea' },
    { key: 'bodyTemplate', label: 'POST body template', type: 'textarea' },
    { key: 'apiKeyHeader', label: 'API key header', type: 'text', placeholder: 'x-api-key' },
    { key: 'cursorParam', label: 'Cursor query parameter', type: 'text', placeholder: 'cursor' },
    {
      key: 'nextCursorPath',
      label: 'Next cursor path',
      type: 'text',
      placeholder: 'pagination.nextCursor',
    },
    { key: 'pageSizeParam', label: 'Page size parameter', type: 'text', placeholder: 'limit' },
    { key: 'pageSize', label: 'Page size', type: 'number', placeholder: '500' },
    { key: 'maxPages', label: 'Maximum pages', type: 'number', placeholder: '1' },
  ],
  secretFields: [
    { key: 'bearerToken', label: 'Bearer token' },
    { key: 'apiKey', label: 'API key' },
  ],
  async test(ctx) {
    try {
      const cfg = ctx.config as HttpJsonConfig
      await fetchJson({ ...cfg, maxPages: 1 }, ctx, null)
      return { ok: true, message: 'Fetched JSON successfully.' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  },
  async pull(ctx) {
    const cfg = ctx.config as HttpJsonConfig
    const entity = cfg.entity
    if (!entity) {
      ctx.log('warn', 'No target entity selected.')
      return []
    }
    const mapping = parseMapping(cfg.mappingJson)
    const out: CanonicalRecord[] = []
    let cursor = cursorText(ctx.since?.default)
    let nextCursor: string | null = null
    let truncated = false
    const maxPages = Math.max(1, Math.min(Number(cfg.maxPages ?? 1) || 1, 50))

    for (let page = 0; page < maxPages; page++) {
      const payload = await fetchJson(cfg, ctx, cursor)
      const rows = rowsAt(payload, cfg.recordsPath)
      ctx.log('info', `HTTP JSON page ${page + 1}: ${rows.length} row(s)`)
      for (const row of rows) {
        const rec = mapRow(entity, cfg, mapping, row)
        if (rec) out.push(rec)
      }
      nextCursor = cfg.nextCursorPath ? cursorText(getPath(payload, cfg.nextCursorPath)) : null
      if (!nextCursor || nextCursor === cursor) break
      if (page === maxPages - 1) {
        // Page cap hit with more data behind the cursor — this pull is a
        // partial snapshot, never a full one.
        truncated = true
        break
      }
      cursor = nextCursor
    }

    if (truncated) {
      ctx.log(
        'warn',
        `Stopped after ${maxPages} page(s) with more data remaining; treating the pull as incremental so the missing-record policy is not applied to a partial snapshot.`,
      )
    }

    return {
      records: out,
      nextCursor: nextCursor ? { default: nextCursor } : undefined,
      mode: ctx.since?.default || truncated ? 'incremental' : 'full',
    }
  },
}
