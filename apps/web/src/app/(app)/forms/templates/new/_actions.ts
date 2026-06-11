'use server'

// App creation — kind-aware. Each app "kind" (form / wizard / checklist /
// register / mini_app) seeds a DIFFERENT starter schema so the designer opens
// already shaped for that type (a wizard has steps, a register has a table,
// etc.). The kind is persisted on form_templates.kind.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { formTemplates, formTemplateVersions } from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export type AppKind = 'form' | 'wizard' | 'checklist' | 'register' | 'mini_app'

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

const txt = (id: string, label: string) => ({
  id,
  type: 'text' as const,
  label: { en: label },
  required: false,
})
const long = (id: string, label: string) => ({
  id,
  type: 'long_text' as const,
  label: { en: label },
  required: false,
})
const yesno = (id: string, label: string) => ({
  id,
  type: 'yes_no_comment' as const,
  label: { en: label },
  required: false,
})
const submitterStep = (key: string, title: string) => ({
  key,
  title: { en: title },
  assignee: { type: 'expression' as const, expr: '$submitter' },
})

// Build a kind-specific starter schema.
function starterSchema(kind: AppKind, name: string, description: string | null): FormSchemaV1 {
  const base = {
    schemaVersion: 1 as const,
    title: { en: name },
    description: description ? { en: description } : undefined,
  }

  switch (kind) {
    case 'wizard':
      return {
        ...base,
        sections: [
          {
            id: 'sec_step1',
            title: { en: 'Step 1' },
            step: 'step_1',
            fields: [txt('field_a', 'First field')],
          },
          {
            id: 'sec_step2',
            title: { en: 'Step 2' },
            step: 'step_2',
            fields: [txt('field_b', 'Second field')],
          },
          {
            id: 'sec_review',
            title: { en: 'Review & submit' },
            step: 'step_review',
            fields: [long('field_notes', 'Anything else?')],
          },
        ],
        workflow: {
          steps: [
            submitterStep('step_1', 'Step 1'),
            submitterStep('step_2', 'Step 2'),
            submitterStep('step_review', 'Review & submit'),
          ],
        },
      }

    case 'checklist':
      return {
        ...base,
        sections: [
          {
            id: 'sec_checks',
            title: { en: 'Checklist' },
            description: { en: 'Each item captures a Yes/No answer with an optional comment.' },
            fields: [
              yesno('check_1', 'Item 1 in good condition?'),
              yesno('check_2', 'Item 2 in good condition?'),
              yesno('check_3', 'Item 3 in good condition?'),
            ],
          },
        ],
        workflow: { steps: [submitterStep('submit', 'Submit')] },
      }

    case 'register':
      return {
        ...base,
        sections: [
          {
            id: 'sec_log',
            title: { en: 'Register' },
            description: { en: 'An append-and-browse log. Add a row per entry.' },
            fields: [
              {
                id: 'entries',
                type: 'table' as const,
                label: { en: 'Entries' },
                required: false,
                config: {
                  rowMode: 'addable',
                  columns: [
                    { key: 'date', label: 'Date', type: 'date' },
                    { key: 'item', label: 'Item', type: 'text' },
                    { key: 'qty', label: 'Quantity', type: 'number' },
                    { key: 'notes', label: 'Notes', type: 'text' },
                  ],
                },
              },
            ],
          },
        ],
        workflow: { steps: [submitterStep('submit', 'Submit')] },
      }

    case 'mini_app':
      // Opens in free-form CANVAS mode to showcase the visual builder.
      return {
        ...base,
        sections: [
          {
            id: 'sec_1',
            title: { en: 'Dashboard' },
            canvas: {
              cols: 12,
              rowHeight: 40,
              items: [
                { i: 'w_title', x: 0, y: 0, w: 12, h: 1 },
                { i: 'field_a', x: 0, y: 1, w: 6, h: 2 },
                { i: 'field_b', x: 6, y: 1, w: 6, h: 2 },
                { i: 'field_notes', x: 0, y: 3, w: 12, h: 3 },
              ],
            },
            fields: [
              {
                id: 'w_title',
                type: 'heading' as const,
                label: { en: 'Welcome to your app' },
                required: false,
              },
              txt('field_a', 'Field A'),
              txt('field_b', 'Field B'),
              long('field_notes', 'Notes'),
            ],
          },
        ],
        workflow: { steps: [submitterStep('submit', 'Submit')] },
      }

    case 'form':
    default:
      return {
        ...base,
        sections: [
          {
            id: 'sec_intro',
            title: { en: 'Details' },
            fields: [txt('field_title', 'Title'), long('field_notes', 'Notes')],
          },
        ],
        workflow: { steps: [submitterStep('submit', 'Submit')] },
      }
  }
}

export async function createApp(input: {
  kind: AppKind
  name: string
  category?: string | null
  moduleBinding?: string | null
  description?: string | null
}): Promise<{ ok: false; error: string } | void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.template.create')

  const name = (input.name ?? '').trim()
  if (!name) return { ok: false, error: 'A name is required' }
  const kind: AppKind = input.kind ?? 'form'
  const category = input.category?.trim() || null
  const moduleBinding = input.moduleBinding?.trim() || null
  const description = input.description?.trim() || null
  const key = `${slugify(name)}_${Math.random().toString(36).slice(2, 6)}`

  const schema = starterSchema(kind, name, description)

  const templateId = await ctx.db(async (tx) => {
    // Guard a key collision (rare given the random suffix).
    const existing = await tx
      .select({ id: formTemplates.id })
      .from(formTemplates)
      .where(eq(formTemplates.key, key))
      .limit(1)
    const finalKey = existing.length ? `${key}_${Math.random().toString(36).slice(2, 5)}` : key

    const [tmpl] = await tx
      .insert(formTemplates)
      .values({
        tenantId: ctx.tenantId,
        key: finalKey,
        name,
        kind,
        category: category as never,
        description,
        moduleBinding,
        status: 'draft',
        createdBy: ctx.userId,
      })
      .returning({ id: formTemplates.id })
    if (!tmpl) throw new Error('Failed to insert app')
    await tx.insert(formTemplateVersions).values({
      tenantId: ctx.tenantId,
      templateId: tmpl.id,
      version: 1,
      schema,
    })
    return tmpl.id
  })

  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: templateId,
    action: 'create',
    summary: `Created ${kind} "${name}"`,
    after: { name, kind, category, moduleBinding, mode: 'kind-picker' },
  })
  revalidatePath('/forms')
  redirect(`/forms/templates/${templateId}/designer`)
}
