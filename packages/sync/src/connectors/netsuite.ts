// NetSuite connector (native). Pulls from NetSuite's modern REST API via
// SuiteQL, authenticated with Token-Based Authentication (TBA = OAuth 1.0a,
// HMAC-SHA256) — the standard for server-to-server. ALL credentials are stored
// encrypted per-connection in the DB (no env vars): the account id is config;
// consumer key/secret + token id/secret are sealed secrets.
//
// Defaults map NetSuite `employee` → People and `location` → Locations so it
// works with credentials alone; WHERE filters and full per-entity overrides are
// optional config.

import { createHmac, randomBytes } from 'node:crypto'
import type { CanonicalRecord, Connector, ConnectorRunContext, SyncEntityKey } from '../types'

interface NsCreds {
  accountId: string
  consumerKey: string
  consumerSecret: string
  tokenId: string
  tokenSecret: string
}

interface NsEntityMap {
  table: string
  idColumn: string
  columns: Record<string, string> // canonical field → NetSuite column (lowercase)
  where?: string
  level?: 'customer' | 'project' | 'site' | 'area'
}

interface NsConfig {
  accountId?: string
  employeeWhere?: string
  locationWhere?: string
  // Advanced: full per-entity override (table + column map + where).
  entities?: Partial<Record<SyncEntityKey, NsEntityMap>>
}

const DEFAULTS: Partial<Record<SyncEntityKey, NsEntityMap>> = {
  people: {
    table: 'employee',
    idColumn: 'id',
    columns: {
      firstName: 'firstname',
      lastName: 'lastname',
      employeeNo: 'entityid',
      email: 'email',
      phone: 'phone',
      jobTitle: 'title',
      hireDate: 'hiredate',
    },
    where: "isinactive = 'F'",
  },
  org_unit: {
    table: 'location',
    idColumn: 'id',
    // code = NetSuite internal id, parentCode = parent location id, so the
    // hierarchy resolves through the crosswalk's code lookup.
    columns: { name: 'name', code: 'id', parentCode: 'parent' },
    where: "isinactive = 'F'",
    level: 'site',
  },
}

// RFC-3986 percent-encoding (OAuth requires escaping !*'() that encodeURIComponent leaves).
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

export function nsHost(accountId: string): string {
  return `${accountId.toLowerCase().replace(/_/g, '-')}.suitetalk.api.netsuite.com`
}

// Build the OAuth 1.0a (HMAC-SHA256) Authorization header for a NetSuite REST
// request. nonce/timestamp are injectable for deterministic testing.
export function signOAuth1a(
  method: string,
  fullUrl: string,
  creds: NsCreds,
  opts?: { nonce?: string; timestamp?: string },
): string {
  const u = new URL(fullUrl)
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_token: creds.tokenId,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: opts?.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_nonce: opts?.nonce ?? randomBytes(16).toString('hex'),
    oauth_version: '1.0',
  }
  const params: [string, string][] = []
  for (const [k, v] of u.searchParams) params.push([rfc3986(k), rfc3986(v)])
  for (const [k, v] of Object.entries(oauth)) params.push([rfc3986(k), rfc3986(v)])
  params.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  )
  const paramString = params.map(([k, v]) => `${k}=${v}`).join('&')
  const baseString = `${method.toUpperCase()}&${rfc3986(`${u.origin}${u.pathname}`)}&${rfc3986(paramString)}`
  const signingKey = `${rfc3986(creds.consumerSecret)}&${rfc3986(creds.tokenSecret)}`
  const signature = createHmac('sha256', signingKey).update(baseString).digest('base64')
  const header: Record<string, string> = { ...oauth, oauth_signature: signature }
  const parts = Object.entries(header).map(([k, v]) => `${rfc3986(k)}="${rfc3986(v)}"`)
  return `OAuth realm="${rfc3986(creds.accountId.toUpperCase())}", ${parts.join(', ')}`
}

function credsOf(ctx: ConnectorRunContext): NsCreds {
  const cfg = ctx.config as NsConfig
  return {
    accountId: (cfg.accountId ?? '').trim(),
    consumerKey: ctx.secrets.consumerKey ?? '',
    consumerSecret: ctx.secrets.consumerSecret ?? '',
    tokenId: ctx.secrets.tokenId ?? '',
    tokenSecret: ctx.secrets.tokenSecret ?? '',
  }
}

async function suiteql(
  creds: NsCreds,
  q: string,
  limit: number,
  offset: number,
): Promise<{ items: Record<string, unknown>[]; hasMore: boolean }> {
  const url = `https://${nsHost(creds.accountId)}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: signOAuth1a('POST', url, creds),
      'Content-Type': 'application/json',
      Prefer: 'transient',
    },
    body: JSON.stringify({ q }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`NetSuite ${res.status}: ${t.slice(0, 300)}`)
  }
  const json = (await res.json()) as { items?: Record<string, unknown>[]; hasMore?: boolean }
  return { items: json.items ?? [], hasMore: json.hasMore ?? false }
}

function val(row: Record<string, unknown>, col: string | undefined): string | null {
  if (!col) return null
  const v = row[col]
  if (v == null) return null
  const s = String(v)
  return s === '' ? null : s
}

function datePart(v: string | null): string | null {
  if (!v) return null
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1] ?? null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

export function mapNetsuiteRow(
  entity: SyncEntityKey,
  m: NsEntityMap,
  row: Record<string, unknown>,
): CanonicalRecord | null {
  const g = (f: string) => val(row, m.columns[f])
  const externalId = val(row, m.idColumn) ?? ''
  if (!externalId) return null
  switch (entity) {
    case 'people': {
      const data = {
        firstName: g('firstName') ?? '',
        lastName: g('lastName') ?? '',
        employeeNo: g('employeeNo'),
        email: g('email'),
        phone: g('phone'),
        jobTitle: g('jobTitle'),
        hireDate: datePart(g('hireDate')),
      }
      if (!data.firstName && !data.lastName) return null
      return { entity: 'people', externalId, data }
    }
    case 'org_unit': {
      const data = {
        name: g('name') ?? '',
        code: g('code'),
        parentCode: g('parentCode'),
        level: m.level ?? 'site',
      }
      if (!data.name) return null
      return { entity: 'org_unit', externalId, data }
    }
    case 'equipment': {
      const data = {
        name: g('name') ?? g('assetTag') ?? '',
        assetTag: g('assetTag') ?? '',
        serialNumber: g('serialNumber'),
        typeName: g('typeName'),
      }
      if (!data.assetTag) return null
      return { entity: 'equipment', externalId, data }
    }
  }
}

function resolveEntities(cfg: NsConfig): [SyncEntityKey, NsEntityMap][] {
  const out: [SyncEntityKey, NsEntityMap][] = []
  const people = cfg.entities?.people ?? DEFAULTS.people
  const org = cfg.entities?.org_unit ?? DEFAULTS.org_unit
  if (people)
    out.push(['people', cfg.employeeWhere ? { ...people, where: cfg.employeeWhere } : people])
  if (org) out.push(['org_unit', cfg.locationWhere ? { ...org, where: cfg.locationWhere } : org])
  if (cfg.entities?.equipment) out.push(['equipment', cfg.entities.equipment])
  return out
}

export const netsuiteConnector: Connector = {
  key: 'netsuite',
  name: 'NetSuite',
  description:
    'Sync employees and locations from NetSuite via the REST/SuiteQL API. Uses Token-Based Authentication; all credentials are stored encrypted per connection.',
  kind: 'native',
  iconKey: 'building-2',
  entities: ['people', 'org_unit'],
  configFields: [
    {
      key: 'accountId',
      label: 'Account ID',
      type: 'text',
      required: true,
      placeholder: '1234567 or 1234567_SB1',
      help: 'Your NetSuite account ID (the realm). Sandboxes look like 1234567_SB1.',
    },
    {
      key: 'employeeWhere',
      label: 'Employee filter (SuiteQL WHERE)',
      type: 'text',
      placeholder: "isinactive = 'F'",
      help: 'Optional. Overrides the default active-only filter on employees.',
    },
    {
      key: 'locationWhere',
      label: 'Location filter (SuiteQL WHERE)',
      type: 'text',
      placeholder: "isinactive = 'F'",
    },
  ],
  secretFields: [
    { key: 'consumerKey', label: 'Consumer key', required: true },
    { key: 'consumerSecret', label: 'Consumer secret', required: true },
    { key: 'tokenId', label: 'Token ID', required: true },
    { key: 'tokenSecret', label: 'Token secret', required: true },
  ],

  async test(ctx) {
    const creds = credsOf(ctx)
    if (!creds.accountId) return { ok: false, message: 'Enter the NetSuite account ID first.' }
    if (!creds.consumerKey || !creds.tokenId)
      return { ok: false, message: 'Enter all four NetSuite credentials, then save.' }
    try {
      await suiteql(creds, 'SELECT id FROM employee', 1, 0)
      return { ok: true, message: 'Connected to NetSuite.' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  },

  async pull(ctx) {
    const cfg = ctx.config as NsConfig
    const creds = credsOf(ctx)
    if (!creds.accountId || !creds.consumerKey || !creds.tokenId) {
      ctx.log('warn', 'NetSuite credentials are incomplete.')
      return []
    }
    const out: CanonicalRecord[] = []
    for (const [entity, m] of resolveEntities(cfg)) {
      const cols = [...new Set([m.idColumn, ...Object.values(m.columns)])]
      const q = `SELECT ${cols.join(', ')} FROM ${m.table}${m.where ? ` WHERE ${m.where}` : ''}`
      ctx.log('info', `${entity}: ${q}`)
      const limit = 1000
      let offset = 0
      let page = 0
      let total = 0
      // NetSuite caps SuiteQL pages; loop until hasMore is false.
      for (;;) {
        const { items, hasMore } = await suiteql(creds, q, limit, offset)
        for (const row of items) {
          const rec = mapNetsuiteRow(entity, m, row)
          if (rec) out.push(rec)
        }
        total += items.length
        offset += limit
        page += 1
        if (!hasMore || items.length === 0 || page >= 100) break
      }
      ctx.log('info', `${entity}: ${total} row(s) from ${m.table}`)
    }
    return out
  },
}
