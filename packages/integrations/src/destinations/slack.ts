// Slack / Microsoft Teams destination — posts a token-templated message to an
// incoming-webhook URL. Both platforms accept a simple { text } payload. A
// collection trigger is combined into one message by default (one line per
// item) to avoid flooding the channel.

import { secureFetch } from '@beaconhs/sync'
import { resolveText } from '../resolve'
import { deliveryRef } from '../idempotency'
import type {
  DeliverContext,
  DeliverResult,
  DestinationDef,
  DestinationTestContext,
  IntegrationResult,
} from '../types'

const TIMEOUT_MS = 10_000

async function post(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await secureFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: TIMEOUT_MS,
    maxResponseBytes: 64 * 1024,
    maxRedirects: 1,
  })
  const body = await res.text().catch(() => '')
  return { ok: res.ok, status: res.status, body }
}

async function test(ctx: DestinationTestContext): Promise<IntegrationResult> {
  const url = ctx.secrets.webhookUrl ?? ''
  if (!url) return { ok: false, error: 'A webhook URL is required.' }
  try {
    new URL(url)
  } catch {
    return { ok: false, error: 'The webhook URL is not valid.' }
  }
  try {
    const r = await post(url, { text: 'BeaconHS connection test ✅' })
    return r.ok
      ? { ok: true, summary: 'Posted a test message to the channel.' }
      : {
          ok: false,
          error: `Webhook responded HTTP ${r.status}${r.body ? `: ${r.body.slice(0, 140)}` : ''}`,
        }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function deliver(ctx: DeliverContext): Promise<DeliverResult> {
  const url = ctx.secrets.webhookUrl ?? ''
  if (!url) return { ok: false, error: 'A webhook URL is required.' }
  const platform = ctx.config.platform === 'teams' ? 'teams' : 'slack'
  const tpl = String(ctx.mapping.text ?? '')
  // Slack Block Kit JSON (optional, Slack only). Teams uses its own card schema,
  // so blocks are ignored there.
  const blocksTpl = platform === 'slack' ? String(ctx.mapping.blocks ?? '').trim() : ''
  if (!tpl.trim() && !blocksTpl) {
    return { ok: false, error: 'A message template or blocks JSON is required.' }
  }
  const combine = ctx.config.combine !== false && ctx.config.combine !== 'false'

  // Build the payloads to POST. Rich blocks are sent one message per item;
  // plain text honours the combine toggle.
  const payloads: Record<string, unknown>[] = []
  if (blocksTpl) {
    for (const it of ctx.items) {
      const text = resolveText(tpl, it)
      let blocks: unknown
      try {
        blocks = JSON.parse(resolveText(blocksTpl, it))
      } catch {
        blocks = undefined
      }
      payloads.push(blocks ? { text: text || undefined, blocks } : { text })
    }
  } else if (combine) {
    payloads.push({ text: ctx.items.map((it) => resolveText(tpl, it)).join('\n') })
  } else {
    for (const it of ctx.items) payloads.push({ text: resolveText(tpl, it) })
  }

  let sent = 0
  const errors: string[] = []
  const refs = ctx.retryRefs.map((externalRef) => ({ externalRef }))
  for (let index = 0; index < payloads.length; index++) {
    const payload = payloads[index]!
    if (!payload.text && !payload.blocks) continue
    const ref = deliveryRef('chat', ctx.triggerKey, ctx.subjectId, index)
    if (ctx.retryRefs.includes(ref)) continue
    try {
      const r = await post(url, payload)
      if (r.ok) {
        sent++
        refs.push({ externalRef: ref })
      } else errors.push(`HTTP ${r.status}`)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (errors.length > 0 && sent === 0) return { ok: false, error: errors[0] }
  const note = errors.length ? ` (${errors.length} failed)` : ''
  return {
    ok: errors.length === 0,
    summary: `Posted ${sent} message(s)${note}.`,
    refs,
  }
}

export const slackDestination: DestinationDef = {
  key: 'slack',
  name: 'Slack / Teams message',
  description:
    'Post a formatted message to a Slack or Microsoft Teams channel via a public HTTPS incoming-webhook URL. Combine a multi-item trigger into one message or send one each.',
  iconKey: 'message-square',
  mappingKind: 'slack',
  reversible: false,
  configFields: [
    {
      key: 'platform',
      label: 'Platform',
      type: 'select',
      options: [
        { value: 'slack', label: 'Slack' },
        { value: 'teams', label: 'Microsoft Teams' },
      ],
      help: 'Both use an incoming-webhook URL with a { text } payload.',
    },
    {
      key: 'combine',
      label: 'Combine a multi-item trigger into one message',
      type: 'boolean',
      help: 'On (default): one message, one line per item. Off: one message per item.',
    },
  ],
  secretFields: [
    {
      key: 'webhookUrl',
      label: 'Incoming webhook URL',
      required: true,
      help: 'Must be a public HTTPS URL.',
    },
  ],
  test,
  deliver,
}
