// Google Sheets destination — append a row per item to a spreadsheet via the
// Sheets API. Authenticates with a Google **service account** (paste its JSON
// key): we mint a short-lived access token by signing a JWT (RS256) and
// exchanging it, so there's no interactive OAuth. Share the target sheet with
// the service account's client_email as an Editor.

import { createSign } from 'node:crypto'
import { secureFetch } from '@beaconhs/sync'
import { resolveValue } from '../resolve'
import type {
  DeliverContext,
  DeliverResult,
  DestinationDef,
  DestinationTestContext,
  IntegrationResult,
  Item,
} from '../types'

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const TIMEOUT_MS = 12_000

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const j = JSON.parse(raw) as Partial<ServiceAccount>
    if (j.client_email && j.private_key) {
      return { client_email: j.client_email, private_key: j.private_key, token_uri: j.token_uri }
    }
  } catch {
    /* invalid JSON */
  }
  return null
}

async function mintToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  )
  const signingInput = `${header}.${claim}`
  const signature = b64url(createSign('RSA-SHA256').update(signingInput).sign(sa.private_key))
  const assertion = `${signingInput}.${signature}`

  const res = await secureFetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    timeoutMs: TIMEOUT_MS,
    maxResponseBytes: 1024 * 1024,
    maxRedirects: 1,
  })
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error_description?: string
  }
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || `Token request failed (HTTP ${res.status}).`)
  }
  return json.access_token
}

function rowFor(values: unknown, item: Item): unknown[] {
  const list = Array.isArray(values) ? values : []
  return list.map((expr) => {
    const v = resolveValue(expr, item)
    return v === null ? '' : v
  })
}

async function test(ctx: DestinationTestContext): Promise<IntegrationResult> {
  const sa = parseServiceAccount(ctx.secrets.serviceAccountJson ?? '')
  if (!sa) return { ok: false, error: 'Paste a valid service-account JSON key.' }
  const spreadsheetId = String(ctx.config.spreadsheetId ?? '').trim()
  if (!spreadsheetId) return { ok: false, error: 'A spreadsheet id is required.' }
  try {
    const token = await mintToken(sa)
    const res = await secureFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title`,
      {
        headers: { authorization: `Bearer ${token}` },
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: 1024 * 1024,
        maxRedirects: 1,
      },
    )
    const json = (await res.json().catch(() => ({}))) as {
      properties?: { title?: string }
      error?: { message?: string }
    }
    if (!res.ok) {
      return {
        ok: false,
        error:
          json.error?.message ||
          `Cannot open the sheet (HTTP ${res.status}). Share it with ${sa.client_email}.`,
      }
    }
    return { ok: true, summary: `Connected to "${json.properties?.title ?? spreadsheetId}".` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function deliver(ctx: DeliverContext): Promise<DeliverResult> {
  const sa = parseServiceAccount(ctx.secrets.serviceAccountJson ?? '')
  if (!sa) return { ok: false, error: 'Service-account JSON is not configured.' }
  const spreadsheetId = String(ctx.config.spreadsheetId ?? '').trim()
  if (!spreadsheetId) return { ok: false, error: 'A spreadsheet id is required.' }
  const range = String(ctx.config.range ?? 'Sheet1').trim() || 'Sheet1'
  const valueInputOption = ctx.config.valueInputOption === 'RAW' ? 'RAW' : 'USER_ENTERED'
  const values = (ctx.mapping.values as unknown[] | undefined) ?? []
  if (!Array.isArray(values) || values.length === 0) {
    return { ok: false, error: 'No column values mapped.' }
  }

  const rows = ctx.items.map((item) => rowFor(values, item))
  try {
    const token = await mintToken(sa)
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`
    const res = await secureFetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: rows }),
      timeoutMs: TIMEOUT_MS,
      maxResponseBytes: 1024 * 1024,
      maxRedirects: 1,
    })
    const json = (await res.json().catch(() => ({}))) as {
      updates?: { updatedRange?: string; updatedRows?: number }
      error?: { message?: string }
    }
    if (!res.ok)
      return { ok: false, error: json.error?.message || `Append failed (HTTP ${res.status}).` }
    const updatedRange = json.updates?.updatedRange ?? range
    return {
      ok: true,
      summary: `Appended ${json.updates?.updatedRows ?? rows.length} row(s) to ${updatedRange}.`,
      refs: [{ externalRef: updatedRange }],
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export const sheetsDestination: DestinationDef = {
  key: 'sheets',
  name: 'Google Sheets',
  description:
    'Append a row per item to a Google Sheet. Authenticates with a service-account key (no interactive sign-in) — share the sheet with the service account as an Editor.',
  iconKey: 'sheet',
  mappingKind: 'sheets',
  reversible: false,
  configFields: [
    {
      key: 'spreadsheetId',
      label: 'Spreadsheet id',
      type: 'text',
      required: true,
      placeholder: '1A2b3C…',
      help: 'The id from the sheet URL: docs.google.com/spreadsheets/d/<id>/edit.',
    },
    {
      key: 'range',
      label: 'Sheet / range',
      type: 'text',
      placeholder: 'Sheet1',
      help: 'Tab name or A1 range to append after. Default: Sheet1.',
    },
    {
      key: 'valueInputOption',
      label: 'Value input',
      type: 'select',
      options: [
        { value: 'USER_ENTERED', label: 'User entered (parse numbers/dates)' },
        { value: 'RAW', label: 'Raw (store as text)' },
      ],
    },
  ],
  secretFields: [
    {
      key: 'serviceAccountJson',
      label: 'Service-account JSON key',
      required: true,
      help: 'Paste the entire JSON key file for a Google service account.',
    },
  ],
  test,
  deliver,
}
