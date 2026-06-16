// Nango connector (provider-backed). Nango is "just another connector" — it
// brokers 400+ SaaS sources (NetSuite, QuickBooks, Xero, Workday…). Self-serve
// auth happens through Nango's Connect UI (we mint a session token here);
// records are pulled from Nango's unified /records API and mapped to canonical.
//
// Server config: NANGO_SECRET_KEY (+ optional NANGO_HOST). A per-connection
// secret key may override the env default.

import { createHash } from 'node:crypto'
import type { CanonicalRecord, Connector, ConnectorRunContext, SyncEntityKey } from '../types'

interface NangoConfig {
  integrationId?: string
  connectionId?: string
  host?: string
  models?: Partial<Record<SyncEntityKey, string>>
  fieldMaps?: Partial<Record<SyncEntityKey, Record<string, string>>>
}

function host(ctx: ConnectorRunContext): string {
  const cfg = ctx.config as NangoConfig
  return cfg.host?.trim() || process.env.NANGO_HOST || 'https://api.nango.dev'
}
function secretKey(ctx: ConnectorRunContext): string {
  return ctx.secrets.secretKey || process.env.NANGO_SECRET_KEY || ''
}

async function nangoFetch(
  ctx: ConnectorRunContext,
  path: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<Response> {
  const key = secretKey(ctx)
  if (!key) throw new Error('NANGO_SECRET_KEY is not configured on the server.')
  const res = await fetch(`${host(ctx)}${path}`, {
    method: init?.method ?? 'GET',
    body: init?.body,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Nango ${res.status}: ${t.slice(0, 300)}`)
  }
  return res
}

function pick(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k]
    if (v != null && v !== '') return typeof v === 'string' ? v : String(v)
  }
  return null
}
function fld(
  rec: Record<string, unknown>,
  map: Record<string, string> | undefined,
  field: string,
  defaults: string[],
): string | null {
  const m = map?.[field]
  return m ? pick(rec, [m]) : pick(rec, defaults)
}
function hashRec(o: unknown): string {
  return createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16)
}

function mapNango(
  entity: SyncEntityKey,
  rec: Record<string, unknown>,
  map: Record<string, string> | undefined,
): CanonicalRecord | null {
  switch (entity) {
    case 'people': {
      const data = {
        firstName:
          fld(rec, map, 'firstName', ['first_name', 'firstName', 'givenName', 'first']) ?? '',
        lastName:
          fld(rec, map, 'lastName', ['last_name', 'lastName', 'familyName', 'surname', 'last']) ??
          '',
        employeeNo: fld(rec, map, 'employeeNo', [
          'employee_number',
          'employeeNumber',
          'employee_id',
          'number',
        ]),
        email: fld(rec, map, 'email', ['email', 'work_email', 'workEmail']),
        phone: fld(rec, map, 'phone', ['phone', 'phone_number', 'mobile_phone']),
        jobTitle: fld(rec, map, 'jobTitle', ['title', 'job_title', 'jobTitle']),
        departmentName: fld(rec, map, 'departmentName', ['department', 'department_name']),
        hireDate: fld(rec, map, 'hireDate', ['hire_date', 'start_date', 'startDate', 'hireDate']),
      }
      if (!data.firstName && !data.lastName) return null
      const externalId =
        pick(rec, ['id', 'employee_id', '_nango_id']) || data.employeeNo || hashRec(rec)
      return { entity: 'people', externalId, data }
    }
    case 'org_unit': {
      const data = {
        name: fld(rec, map, 'name', ['name', 'location_name', 'site_name', 'display_name']) ?? '',
        code: fld(rec, map, 'code', ['code', 'number', 'external_id']),
      }
      if (!data.name) return null
      const externalId = pick(rec, ['id', '_nango_id']) || data.code || hashRec(rec)
      return { entity: 'org_unit', externalId, data }
    }
    case 'equipment': {
      const data = {
        name: fld(rec, map, 'name', ['name', 'description', 'model']) ?? '',
        assetTag: fld(rec, map, 'assetTag', ['asset_tag', 'tag', 'serial_number', 'number']) ?? '',
        serialNumber: fld(rec, map, 'serialNumber', ['serial_number', 'serial']),
        typeName: fld(rec, map, 'typeName', ['type', 'category']),
      }
      if (!data.assetTag) return null
      const externalId = pick(rec, ['id', '_nango_id']) || data.assetTag || hashRec(rec)
      return { entity: 'equipment', externalId, data }
    }
  }
}

export const nangoConnector: Connector = {
  key: 'nango',
  name: 'Nango (400+ apps)',
  description:
    'Connect SaaS sources through Nango — NetSuite, QuickBooks, Xero, Workday and more. Customers authorise their own account; records sync through your Nango project.',
  kind: 'provider',
  iconKey: 'plug-zap',
  entities: ['people', 'org_unit', 'equipment'],
  supportsConnect: true,
  configFields: [
    {
      key: 'integrationId',
      label: 'Nango integration ID',
      type: 'text',
      required: true,
      placeholder: 'netsuite',
      help: 'The integration (provider config key) configured in your Nango project.',
    },
    {
      key: 'connectionId',
      label: 'Connection ID',
      type: 'text',
      help: 'Filled in automatically after a customer authorises, or paste an existing connection ID.',
    },
    {
      key: 'host',
      label: 'Nango host',
      type: 'text',
      placeholder: 'https://api.nango.dev',
      help: 'Optional. Defaults to Nango Cloud; set this for a self-hosted Nango.',
    },
  ],
  secretFields: [
    {
      key: 'secretKey',
      label: 'Nango secret key',
      help: 'Stored encrypted. Required unless a platform-wide NANGO_SECRET_KEY is configured.',
    },
  ],

  async test(ctx) {
    const cfg = ctx.config as NangoConfig
    if (!cfg.connectionId || !cfg.integrationId)
      return { ok: false, message: 'Not connected yet — authorise a source first.' }
    try {
      await nangoFetch(
        ctx,
        `/connection/${encodeURIComponent(cfg.connectionId)}?provider_config_key=${encodeURIComponent(
          cfg.integrationId,
        )}`,
      )
      return { ok: true, message: 'Connection is live.' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  },

  async startConnect(ctx) {
    const cfg = ctx.config as NangoConfig
    const body = JSON.stringify({
      end_user: { id: ctx.tenantId },
      ...(cfg.integrationId ? { allowed_integrations: [cfg.integrationId] } : {}),
    })
    const res = await nangoFetch(ctx, '/connect/sessions', { method: 'POST', body })
    const json = (await res.json()) as { data?: { token?: string } }
    const token = json.data?.token
    if (!token) throw new Error('Nango did not return a session token.')
    return { kind: 'nango', sessionToken: token }
  },

  async pull(ctx) {
    const cfg = ctx.config as NangoConfig
    const models = cfg.models ?? {}
    if (!cfg.connectionId || !cfg.integrationId) {
      ctx.log('warn', 'Nango connection is not fully configured.')
      return []
    }
    const connectionId = cfg.connectionId
    const integrationId = cfg.integrationId
    const out: CanonicalRecord[] = []
    for (const entity of Object.keys(models) as SyncEntityKey[]) {
      const model = models[entity]
      if (!model) continue
      let cursor: string | null = null
      let page = 0
      do {
        const url = `/records?model=${encodeURIComponent(model)}${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`
        const res = await nangoFetch(ctx, url, {
          headers: { 'Connection-Id': connectionId, 'Provider-Config-Key': integrationId },
        })
        const json = (await res.json()) as {
          records?: Record<string, unknown>[]
          next_cursor?: string | null
        }
        for (const r of json.records ?? []) {
          const rec = mapNango(entity, r, cfg.fieldMaps?.[entity])
          if (rec) out.push(rec)
        }
        cursor = json.next_cursor ?? null
        page++
      } while (cursor && page < 50)
      ctx.log('info', `${entity}: pulled from Nango model "${model}".`)
    }
    return out
  },
}
