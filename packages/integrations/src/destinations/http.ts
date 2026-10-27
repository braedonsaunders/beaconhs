// HTTP request destination — POST/PUT/PATCH/DELETE to any URL. Covers REST
// APIs, incoming webhooks (Slack/Teams/Discord), Zapier catch hooks and
// custom apps. Requests go one per item, as one batched array, or as one
// whole-event snapshot; the URL, headers and body are all token-templated.
// A JSON response may report non-fatal `warnings` (strings, or objects with
// a `message`) and `skipped` entries — both are recorded with the delivery
// so the source record can show what the destination did not take. An
// optional sealed auth header value carries a bearer token / API key.

import { secureFetch } from '@beaconhs/sync'
import { resolveText } from '../resolve'
import { deliveryRef } from '../idempotency'
import type {
  DeliverContext,
  DeliverRef,
  DeliverResult,
  DestinationDef,
  DestinationTestContext,
  IntegrationResult,
  Item,
} from '../types'

const TIMEOUT_MS = 10_000

type HttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const HTTP_METHODS: readonly HttpMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE']

function isHttpMethod(v: string): v is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(v)
}

interface HttpConfig {
  method: HttpMethod
  url: string
  contentType: string
  authHeaderName: string
  methodField: string
  methodMap: Record<string, HttpMethod>
}

/** Parse `value=METHOD, other=METHOD` pairs; blank/invalid entries drop out. */
export function parseMethodMap(raw: unknown): Record<string, HttpMethod> {
  const out: Record<string, HttpMethod> = {}
  for (const pair of String(raw ?? '').split(',')) {
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const value = pair.slice(0, eq).trim()
    const method = pair
      .slice(eq + 1)
      .trim()
      .toUpperCase()
    if (value && isHttpMethod(method)) out[value] = method
  }
  return out
}

function parseConfig(config: Record<string, unknown>): HttpConfig {
  const method = String(config.method ?? 'POST').toUpperCase()
  return {
    method: isHttpMethod(method) ? method : 'POST',
    url: String(config.url ?? '').trim(),
    contentType: String(config.contentType ?? 'application/json').trim() || 'application/json',
    authHeaderName: String(config.authHeaderName ?? 'Authorization').trim() || 'Authorization',
    methodField: String(config.methodField ?? '').trim(),
    methodMap: parseMethodMap(config.methodMap),
  }
}

/** The configured method, overridden when an item field maps to another. */
export function methodFor(cfg: HttpConfig, item: Item): HttpMethod {
  if (!cfg.methodField) return cfg.method
  const value = item[cfg.methodField]
  if (value == null) return cfg.method
  return cfg.methodMap[String(value)] ?? cfg.method
}

function headersFor(
  cfg: HttpConfig,
  authValue: string,
  mapping: Record<string, unknown>,
  item: Item,
  idempotencyKey?: string,
): Record<string, string> {
  const out: Record<string, string> = { 'content-type': cfg.contentType }
  if (authValue) out[cfg.authHeaderName] = authValue
  const extra = (mapping.headers as Record<string, string> | undefined) ?? {}
  for (const [k, v] of Object.entries(extra)) {
    if (k.trim()) out[k.trim()] = resolveText(String(v ?? ''), item)
  }
  if (
    idempotencyKey &&
    !Object.keys(out).some((name) => name.toLowerCase() === 'idempotency-key')
  ) {
    out['Idempotency-Key'] = idempotencyKey
  }
  return out
}

function bodyFor(mapping: Record<string, unknown>, item: Item): string {
  const tpl = String(mapping.body ?? '')
  if (!tpl.trim()) return JSON.stringify(item)
  return resolveText(tpl, item)
}

/**
 * Body for one whole-event request. The default is the raw event envelope
 * (`{trigger, subjectId, items}`) so structured data never passes through
 * string interpolation. A configured template resolves its scalar tokens
 * against the first item and may embed `{{items}}` (the items as a JSON
 * array), `{{subjectId}}` and `{{triggerKey}}`.
 */
export function eventBodyFor(
  mapping: Record<string, unknown>,
  ctx: Pick<DeliverContext, 'triggerKey' | 'subjectId' | 'items'>,
): string {
  const tpl = String(mapping.body ?? '')
  if (!tpl.trim()) {
    return JSON.stringify({ trigger: ctx.triggerKey, subjectId: ctx.subjectId, items: ctx.items })
  }
  const first = ctx.items[0] ?? {}
  // Park the event-level tokens behind sentinels so per-item resolution
  // cannot blank them (or reach inside the substituted JSON afterwards).
  const parked = tpl
    .replace(/\{\{\s*items\s*\}\}/g, '\u0001items\u0001')
    .replace(/\{\{\s*subjectId\s*\}\}/g, '\u0001subjectId\u0001')
    .replace(/\{\{\s*triggerKey\s*\}\}/g, '\u0001triggerKey\u0001')
  return resolveText(parked, first)
    .replaceAll('\u0001items\u0001', JSON.stringify(ctx.items))
    .replaceAll('\u0001subjectId\u0001', ctx.subjectId)
    .replaceAll('\u0001triggerKey\u0001', ctx.triggerKey)
}

function warningText(entry: unknown): string | null {
  if (typeof entry === 'string') return entry.trim() || null
  if (entry && typeof entry === 'object') {
    const o = entry as Record<string, unknown>
    const message =
      typeof o.message === 'string'
        ? o.message.trim()
        : typeof o.reason === 'string'
          ? o.reason.trim()
          : ''
    if (!message) return null
    const who = [o.fullName, o.name, o.externalEmployeeId, o.personId].find(
      (v) => typeof v === 'string' && v.trim(),
    ) as string | undefined
    const day = typeof o.date === 'string' && o.date.trim() ? o.date.trim() : undefined
    const parts = [who, day].filter(Boolean)
    return parts.length > 0 ? `${parts.join(' · ')}: ${message}` : message
  }
  return null
}

/** Non-fatal destination notes from a JSON response body, capped for storage. */
export function responseWarnings(body: string): string[] {
  if (!body) return []
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return []
  }
  if (!json || typeof json !== 'object') return []
  const o = json as Record<string, unknown>
  const out: string[] = []
  for (const key of ['warnings', 'skipped'] as const) {
    const list = o[key]
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      const text = warningText(entry)
      if (text) out.push(text.slice(0, 300))
      if (out.length >= 50) return out
    }
  }
  return out
}

async function test(ctx: DestinationTestContext): Promise<IntegrationResult> {
  const cfg = parseConfig(ctx.config)
  if (!cfg.url) return { ok: false, error: 'A URL is required.' }
  let url: URL
  try {
    url = new URL(cfg.url)
  } catch {
    return { ok: false, error: `"${cfg.url}" is not a valid URL.` }
  }
  // Probe reachability without side effects. Many endpoints reject HEAD with a
  // 4xx/405 — that still proves the host is reachable, so we report the status
  // rather than failing on a non-2xx.
  try {
    const res = await secureFetch(url, {
      method: 'HEAD',
      timeoutMs: TIMEOUT_MS,
      maxResponseBytes: 0,
      maxRedirects: 2,
    })
    return { ok: true, summary: `Endpoint reachable (HTTP ${res.status}).` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function deliver(ctx: DeliverContext): Promise<DeliverResult> {
  const cfg = parseConfig(ctx.config)
  if (!cfg.url) return { ok: false, error: 'A URL is required.' }
  const authValue = ctx.secrets.authValue ?? ''
  const refs: DeliverRef[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const batch = ctx.config.batch === true || ctx.config.batch === 'true'
  const wholeEvent = ctx.config.wholeEvent === true || ctx.config.wholeEvent === 'true'

  // Whole-event mode: exactly one request carrying the full snapshot, even
  // when the event has no items, so a destination that mirrors desired state
  // also learns about removals. URL/headers/method resolve against the first
  // item; the stable per-subject ref doubles as the Idempotency-Key so a
  // retry or re-send of the same snapshot cannot double-apply downstream.
  if (wholeEvent) {
    const sample = ctx.items[0] ?? {}
    const ref = deliveryRef('http-event', ctx.triggerKey, ctx.subjectId, 0)
    try {
      const res = await secureFetch(resolveText(cfg.url, sample), {
        method: methodFor(cfg, sample),
        headers: headersFor(cfg, authValue, ctx.mapping, sample, ref),
        body: eventBodyFor(ctx.mapping, ctx),
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: 256 * 1024,
        maxRedirects: 2,
      })
      const text = await res.text().catch(() => '')
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}${text ? `: ${text.slice(0, 140)}` : ''}` }
      }
      const noted = responseWarnings(text)
      return {
        ok: true,
        summary: `Sent 1 event request with ${ctx.items.length} item(s).`,
        refs: [{ externalRef: ref }],
        ...(noted.length > 0 ? { warnings: noted } : {}),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Batch mode: one request whose body is a JSON array of every item's mapped
  // body. URL + headers resolve against the first item.
  if (batch && ctx.items.length > 0) {
    const sample = ctx.items[0] as (typeof ctx.items)[number]
    const ref = deliveryRef('http-batch', ctx.triggerKey, ctx.subjectId, 0)
    const arr = ctx.items.map((it) => {
      const raw = bodyFor(ctx.mapping, it)
      try {
        return JSON.parse(raw) as unknown
      } catch {
        return raw
      }
    })
    try {
      const res = await secureFetch(resolveText(cfg.url, sample), {
        method: methodFor(cfg, sample),
        headers: headersFor(
          cfg,
          authValue,
          ctx.mapping,
          sample,
          ctx.oncePerRecord ? ref : undefined,
        ),
        body: JSON.stringify(arr),
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: 256 * 1024,
        maxRedirects: 2,
      })
      const text = await res.text().catch(() => '')
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}${text ? `: ${text.slice(0, 140)}` : ''}` }
      }
      const noted = responseWarnings(text)
      return {
        ok: true,
        summary: `Sent 1 batch request with ${arr.length} item(s).`,
        refs: [{ externalRef: ref }],
        ...(noted.length > 0 ? { warnings: noted } : {}),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  let sent = 0
  for (let index = 0; index < ctx.items.length; index++) {
    const item = ctx.items[index]!
    const ref = deliveryRef('http', ctx.triggerKey, ctx.subjectId, index)
    if (ctx.retryRefs.includes(ref)) {
      refs.push({ externalRef: ref })
      continue
    }
    const url = resolveText(cfg.url, item)
    try {
      const res = await secureFetch(url, {
        method: methodFor(cfg, item),
        headers: headersFor(cfg, authValue, ctx.mapping, item, ctx.oncePerRecord ? ref : undefined),
        body: bodyFor(ctx.mapping, item),
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: 256 * 1024,
        maxRedirects: 2,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        errors.push(`HTTP ${res.status}${text ? `: ${text.slice(0, 140)}` : ''}`)
        continue
      }
      // Best-effort external ref from a JSON {id}.
      let remoteRef = `${res.status}`
      const body = await res.text().catch(() => '')
      if (body) {
        warnings.push(...responseWarnings(body))
        try {
          const json = JSON.parse(body) as { id?: unknown }
          if (json && json.id != null) remoteRef = String(json.id)
        } catch {
          /* non-JSON response — keep the status */
        }
      }
      refs.push({ externalRef: ref, detail: { remoteRef } })
      sent++
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }

  if (errors.length > 0 && refs.length === 0) {
    return { ok: false, error: errors[0] }
  }
  const resumed = refs.length - sent
  const resumeNote = resumed > 0 ? `; ${resumed} already succeeded on an earlier attempt` : ''
  const note = errors.length ? ` (${errors.length} failed: ${errors[0]})` : ''
  return {
    ok: errors.length === 0,
    summary: `Sent ${sent} request(s)${resumeNote}${note}.`,
    refs,
    ...(warnings.length > 0 ? { warnings: warnings.slice(0, 50) } : {}),
  }
}

export const httpDestination: DestinationDef = {
  key: 'http',
  name: 'HTTP / REST request',
  description:
    'POST, PUT, PATCH or DELETE a token-templated body to a public HTTPS URL with custom headers and an optional bearer/API-key. Use for REST APIs, webhooks and automation hooks. For triggers that carry a full snapshot (like a training class schedule), send one whole-event request so the destination can replace its copy.',
  iconKey: 'webhook',
  mappingKind: 'http',
  reversible: false,
  configFields: [
    {
      key: 'method',
      label: 'Method',
      type: 'select',
      required: true,
      options: [
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
        { value: 'PATCH', label: 'PATCH' },
        { value: 'DELETE', label: 'DELETE' },
      ],
    },
    {
      key: 'methodField',
      label: 'Method override field',
      type: 'text',
      placeholder: 'status',
      help: 'Optional: an item field whose value can switch the method using the map below (for example a status field).',
    },
    {
      key: 'methodMap',
      label: 'Method overrides',
      type: 'text',
      placeholder: 'cancelled=DELETE, deleted=DELETE',
      help: 'Comma-separated value=METHOD pairs applied to the field above. Unlisted values use the method above.',
    },
    {
      key: 'url',
      label: 'URL',
      type: 'text',
      required: true,
      placeholder: 'https://api.example.com/events',
      help: 'Must be public HTTPS. May contain {{tokens}}.',
    },
    {
      key: 'contentType',
      label: 'Content type',
      type: 'select',
      options: [
        { value: 'application/json', label: 'application/json' },
        { value: 'application/x-www-form-urlencoded', label: 'application/x-www-form-urlencoded' },
      ],
    },
    {
      key: 'authHeaderName',
      label: 'Auth header name',
      type: 'text',
      placeholder: 'Authorization',
      help: 'The header the secret below is sent as.',
    },
    {
      key: 'batch',
      label: 'Batch all items into one request',
      type: 'boolean',
      help: 'On: send one request whose JSON body is an array of every item. Off (default): one request per item.',
    },
    {
      key: 'wholeEvent',
      label: 'Send one request for the whole event',
      type: 'boolean',
      help: 'On: send exactly one request per event (even with no items) whose body is the full snapshot — {trigger, subjectId, items} by default, or your body template with {{items}} for the items JSON. Sends a stable Idempotency-Key. Use for destinations that replace their copy of a record. Overrides batch.',
    },
  ],
  secretFields: [
    {
      key: 'authValue',
      label: 'Auth header value',
      help: 'e.g. "Bearer abc123". Sent as the header above. Leave blank for none.',
    },
  ],
  test,
  deliver,
}
