// Email destination — send a token-templated email to arbitrary recipients on a
// trigger. Reuses the platform email pipeline (enqueueEmail → the worker
// resolves the tenant/platform transport and records the audit fan-out), so a
// slow SMTP send never blocks the originating save. A multi-item trigger is
// combined into one email by default.

import {
  EMAIL_RENDER_LIMITS,
  htmlToPlainText,
  normalizeEmailSubject,
  renderTemplate,
  sanitizeTokenizedEmailFragment,
} from '@beaconhs/email-render'
import type {
  DeliverContext,
  DeliverResult,
  DestinationDef,
  DestinationTestContext,
  IntegrationResult,
  Item,
} from '../types'

function recipients(raw: string, item: Item): string[] {
  return renderTemplate(raw, item, { allowRawValues: false })
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'))
}

/** Compile once, then escape every event value before it enters safe authored markup. */
export function createIntegrationEmailBodyRenderer(bodyTemplate: string): (item: Item) => string {
  const sanitized = sanitizeTokenizedEmailFragment(bodyTemplate)
  if (!sanitized.trim()) throw new Error('The email body contained no safe content.')
  return (item) =>
    renderTemplate(sanitized, item, {
      escapeHtml: true,
      // Integration payload fields are record data. Triple braces must not turn
      // them into authored HTML, even if an administrator typed them manually.
      allowRawValues: false,
    })
}

function renderedSubject(template: string, item: Item): string {
  return (
    normalizeEmailSubject(renderTemplate(template, item, { allowRawValues: false })) ||
    'Notification from BeaconHS'
  )
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
    await enqueueEmail({ to, subject, html, text: htmlToPlainText(html), meta })
    sent++
  }

  try {
    const renderBody = createIntegrationEmailBodyRenderer(bodyTpl)
    if (combine) {
      const first = ctx.items[0] as Item
      let html = ''
      for (const item of ctx.items) {
        const part = renderBody(item)
        const separator = html ? '<hr/>' : ''
        if (html.length > EMAIL_RENDER_LIMITS.renderOutputChars - separator.length - part.length) {
          throw new Error(
            `Rendered output exceeded ${EMAIL_RENDER_LIMITS.renderOutputChars} characters.`,
          )
        }
        html += separator + part
      }
      await send(recipients(toTpl, first), renderedSubject(subjectTpl, first), html)
    } else {
      for (const item of ctx.items) {
        await send(recipients(toTpl, item), renderedSubject(subjectTpl, item), renderBody(item))
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
