// HTTP request destination — POST/PUT/PATCH to any URL. Covers REST APIs,
// incoming webhooks (Slack/Teams/Discord), Zapier catch hooks and custom apps.
// One request per item; the URL, headers and body are all token-templated. An
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

interface HttpConfig {
  method: 'POST' | 'PUT' | 'PATCH'
  url: string
  contentType: string
  authHeaderName: string
}

function parseConfig(config: Record<string, unknown>): HttpConfig {
  const method = String(config.method ?? 'POST').toUpperCase()
  return {
    method: method === 'PUT' || method === 'PATCH' ? (method as 'PUT' | 'PATCH') : 'POST',
    url: String(config.url ?? '').trim(),
    contentType: String(config.contentType ?? 'application/json').trim() || 'application/json',
    authHeaderName: String(config.authHeaderName ?? 'Authorization').trim() || 'Authorization',
  }
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
  const batch = ctx.config.batch === true || ctx.config.batch === 'true'

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
        method: cfg.method,
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
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, error: `HTTP ${res.status}${text ? `: ${text.slice(0, 140)}` : ''}` }
      }
      return {
        ok: true,
        summary: `Sent 1 batch request with ${arr.length} item(s).`,
        refs: [{ externalRef: ref }],
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
        method: cfg.method,
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
  }
}

export const httpDestination: DestinationDef = {
  key: 'http',
  name: 'HTTP / REST request',
  description:
    'POST, PUT or PATCH a token-templated body to a public HTTPS URL with custom headers and an optional bearer/API-key. Use for REST APIs, webhooks and automation hooks.',
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
      ],
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
