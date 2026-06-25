// Email destination — send a token-templated email to arbitrary recipients on a
// trigger. Reuses the platform email pipeline (enqueueEmail → the worker
// resolves the tenant/platform transport and records the audit fan-out), so a
// slow SMTP send never blocks the originating save. A multi-item trigger is
// combined into one email by default.

import { resolveText } from '../resolve'
import type {
  DeliverContext,
  DeliverResult,
  DestinationDef,
  DestinationTestContext,
  IntegrationResult,
  Item,
} from '../types'

function recipients(raw: string, item: Item): string[] {
  return resolveText(raw, item)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'))
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

async function test(ctx: DestinationTestContext): Promise<IntegrationResult> {
  const to = String(ctx.config.to ?? '').trim()
  if (!to) return { ok: false, error: 'At least one recipient is required.' }
  // Recipients may be tokens resolved at send time; only flag a clearly-empty
  // static value here.
  if (!to.includes('@') && !to.includes('{{')) {
    return { ok: false, error: `"${to}" is not an email address or token.` }
  }
  return { ok: true, summary: `Will email ${to} via your configured email transport.` }
}

async function deliver(ctx: DeliverContext): Promise<DeliverResult> {
  const toTpl = String(ctx.config.to ?? '').trim()
  const subjectTpl = String(ctx.config.subject ?? '').trim() || 'Notification from BeaconHS'
  const bodyTpl = String(ctx.mapping.body ?? '').trim()
  if (!toTpl) return { ok: false, error: 'No recipients configured.' }
  if (!bodyTpl) return { ok: false, error: 'An email body is required.' }
  const combine = ctx.config.combine !== false && ctx.config.combine !== 'false'
  if (ctx.items.length === 0) return { ok: true, summary: 'No items to send.' }

  const { enqueueEmail } = await import('@beaconhs/jobs')
  const meta = { tenantId: ctx.tenantId, category: 'integration' as const }
  let sent = 0
  const errors: string[] = []

  const send = async (to: string[], subject: string, html: string) => {
    if (to.length === 0) {
      errors.push('no valid recipients')
      return
    }
    await enqueueEmail({ to, subject, html, text: htmlToText(html), meta })
    sent++
  }

  try {
    if (combine) {
      const first = ctx.items[0] as Item
      const html = ctx.items.map((it) => resolveText(bodyTpl, it)).join('<hr/>')
      await send(recipients(toTpl, first), resolveText(subjectTpl, first), html)
    } else {
      for (const item of ctx.items) {
        await send(
          recipients(toTpl, item),
          resolveText(subjectTpl, item),
          resolveText(bodyTpl, item),
        )
      }
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }

  if (errors.length > 0 && sent === 0) return { ok: false, error: errors[0] }
  const note = errors.length ? ` (${errors.length} failed)` : ''
  return {
    ok: errors.length === 0,
    summary: `Queued ${sent} email(s)${note}.`,
    refs: sent > 0 ? [{ externalRef: `email:${ctx.subjectId}` }] : undefined,
  }
}

export const emailDestination: DestinationDef = {
  key: 'email',
  name: 'Email',
  description:
    'Send a token-templated email to any recipients on a trigger, using your tenant email transport. Combine a multi-item trigger into one email or send one each.',
  iconKey: 'mail',
  mappingKind: 'email',
  reversible: false,
  configFields: [
    {
      key: 'to',
      label: 'Recipients',
      type: 'text',
      required: true,
      placeholder: 'safety@example.com, {{reportedByName}}',
      help: 'Comma-separated. May contain {{tokens}}.',
    },
    {
      key: 'subject',
      label: 'Subject',
      type: 'text',
      placeholder: 'New {{type}} — {{reference}}',
    },
    {
      key: 'combine',
      label: 'Combine a multi-item trigger into one email',
      type: 'boolean',
      help: 'On (default): one email listing all items. Off: one email per item.',
    },
  ],
  secretFields: [],
  test,
  deliver,
}
