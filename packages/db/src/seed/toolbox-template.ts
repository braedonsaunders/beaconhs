// Per-tenant seeder for the built-in Toolbox Talk form template.
//
// Toolbox Talks were previously a first-class native module
// (apps/web/toolbox + toolbox_journal* tables). The clean cutover replaces that
// with a form template owned by each tenant — mirroring the lift-plan cutover.
// The template lives behind the bound-modules view at
// /inspections?bound=toolbox_talk and is auto-pinned to the sidebar by key.
//
//   - category='toolbox_talk' + moduleBinding='toolbox_talk' so the bound view
//     picks it up automatically
//   - key='toolbox-talk' as the stable per-tenant identifier
//   - status='published' so users can fill it immediately
//   - emailOnSubmit=true so submitting a talk emails a recap (parity with the
//     old native module's recap email)
//
// Idempotency: ON CONFLICT (tenant_id, key) DO NOTHING — never clobber an
// admin-edited version.

import { and, eq } from 'drizzle-orm'
import type { Database } from '../client'
import { formTemplates, formTemplateVersions } from '../schema'
import type { FormSchemaV1 } from '../schema/forms'

const TOOLBOX_TEMPLATE_KEY = 'toolbox-talk'
const TOOLBOX_TEMPLATE_CATEGORY = 'toolbox_talk'
const TOOLBOX_TEMPLATE_MODULE_BINDING = 'toolbox_talk'
const TOOLBOX_TEMPLATE_NAME = 'Toolbox Talk'

/**
 * The toolbox-talk form template schema. A pre-shift safety discussion with a
 * repeating attendees sign-in section (person + signature) — the attendee rows
 * feed form_response_participants, which power per-person transcripts.
 */
const TOOLBOX_TEMPLATE_SCHEMA: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Toolbox Talk' },
  description: {
    en: 'Pre-shift safety discussion: topic, attendees, key points, action items, photos.',
  },
  sections: [
    {
      id: 'topic',
      title: { en: 'Topic' },
      fields: [
        { id: 'topic', type: 'text', label: { en: 'Topic' }, required: true },
        {
          id: 'date',
          type: 'date',
          label: { en: 'Date' },
          required: true,
          defaultValue: { kind: 'today' },
        },
        { id: 'site', type: 'site_picker', label: { en: 'Site' }, required: true },
        {
          id: 'facilitator',
          type: 'person_picker',
          label: { en: 'Facilitator' },
          required: true,
          defaultValue: { kind: 'current_user_person_id' },
        },
      ],
    },
    {
      id: 'discussion',
      title: { en: 'Discussion' },
      fields: [
        {
          id: 'discussion_notes',
          type: 'long_text',
          label: { en: 'Discussion notes' },
          required: true,
        },
        { id: 'questions_raised', type: 'long_text', label: { en: 'Questions raised' } },
        { id: 'action_items', type: 'long_text', label: { en: 'Action items' } },
      ],
    },
    {
      id: 'attendees',
      title: { en: 'Attendees' },
      description: { en: 'Each attendee signs in.' },
      repeating: true,
      rowLabelTemplate: 'Attendee #{index+1}',
      fields: [
        { id: 'attendee', type: 'person_picker', label: { en: 'Attendee' }, required: true },
        { id: 'attendee_signature', type: 'signature', label: { en: 'Signature' }, required: true },
      ],
    },
    {
      id: 'photos',
      title: { en: 'Photos' },
      fields: [
        {
          id: 'photos',
          type: 'photo',
          label: { en: 'Photos' },
          config: { multiple: true, maxFiles: 10 },
        },
      ],
    },
  ],
  workflow: {
    steps: [
      {
        key: 'submit',
        title: { en: 'Submit' },
        assignee: { type: 'expression', expr: '$submitter' },
      },
    ],
  },
}

type DrizzleTx = Pick<Database, 'select' | 'insert'>

/**
 * Idempotently seed the built-in toolbox-talk form template for one tenant.
 * @returns 'inserted' if newly created, 'skipped' if it already existed.
 */
export async function seedToolboxTemplate(
  tx: DrizzleTx,
  tenantId: string,
): Promise<'inserted' | 'skipped'> {
  const existing = await tx
    .select({ id: formTemplates.id })
    .from(formTemplates)
    .where(and(eq(formTemplates.tenantId, tenantId), eq(formTemplates.key, TOOLBOX_TEMPLATE_KEY)))
    .limit(1)
  if (existing.length > 0) return 'skipped'

  const inserts = await tx
    .insert(formTemplates)
    .values({
      tenantId,
      key: TOOLBOX_TEMPLATE_KEY,
      name: TOOLBOX_TEMPLATE_NAME,
      category: TOOLBOX_TEMPLATE_CATEGORY,
      moduleBinding: TOOLBOX_TEMPLATE_MODULE_BINDING,
      description:
        'Pre-shift safety discussion with topic, attendees, key points, action items and photos.',
      status: 'published' as const,
      emailOnSubmit: true,
      createdBy: null,
    })
    .onConflictDoNothing({ target: [formTemplates.tenantId, formTemplates.key] })
    .returning({ id: formTemplates.id })

  const tmpl = inserts[0]
  if (!tmpl) return 'skipped'

  await tx.insert(formTemplateVersions).values({
    tenantId,
    templateId: tmpl.id,
    version: 1,
    schema: TOOLBOX_TEMPLATE_SCHEMA,
    publishedAt: new Date(),
    publishedBy: null,
    changelog: 'Built-in toolbox-talk template v1',
  })

  return 'inserted'
}
