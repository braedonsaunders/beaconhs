import 'server-only'

// Resolve the full field set + the pickable record types for email templates.
// Native modules and Builder apps are treated the SAME — both are "subjects".

import { desc, eq, isNull } from 'drizzle-orm'
import { formTemplateVersions, formTemplates } from '@beaconhs/db/schema'
import type { FormSchemaV1, I18nString } from '@beaconhs/forms-core'
import type { RequestContext } from '@beaconhs/tenant'
import { MODULE_FLOW_PROFILES } from './module-profiles'

export type SubjectFieldOption = { key: string; label: string }
export type SubjectOption = { type: 'module' | 'form_template'; key: string; label: string }
/** A repeating child collection exposed for {{#each}} tables. */
export type SubjectCollection = { key: string; label: string; fields: SubjectFieldOption[] }

// Content-only field types carry no mergeable value.
const SKIP_FIELD_TYPES = new Set(['heading', 'paragraph', 'divider', 'image', 'metric'])

function labelText(l: I18nString | undefined, fallback: string): string {
  if (typeof l === 'string') return l || fallback
  if (l && typeof l === 'object' && typeof l.en === 'string') return l.en || fallback
  return fallback
}

/** All mergeable fields for a subject — module profile fields OR an app's schema. */
export async function loadSubjectFields(
  ctx: RequestContext,
  subjectType: string | null,
  subjectKey: string | null,
): Promise<SubjectFieldOption[]> {
  if (!subjectType || !subjectKey) return []
  if (subjectType === 'module') {
    return (
      MODULE_FLOW_PROFILES[subjectKey]?.fields.map((f) => ({ key: f.key, label: f.label })) ?? []
    )
  }
  if (subjectType === 'form_template') {
    const [ver] = await ctx.db((tx) =>
      tx
        .select({ schema: formTemplateVersions.schema })
        .from(formTemplateVersions)
        .where(eq(formTemplateVersions.templateId, subjectKey))
        .orderBy(desc(formTemplateVersions.version))
        .limit(1),
    )
    const schema = ver?.schema as FormSchemaV1 | undefined
    if (!schema) return []
    const out: SubjectFieldOption[] = []
    for (const sec of schema.sections ?? []) {
      for (const f of sec.fields ?? []) {
        if (SKIP_FIELD_TYPES.has(f.type)) continue
        out.push({ key: f.id, label: labelText(f.label, f.id) })
      }
    }
    return out
  }
  return []
}

/** Repeating child collections a subject exposes for {{#each}} tables. */
export async function loadSubjectCollections(
  ctx: RequestContext,
  subjectType: string | null,
  subjectKey: string | null,
): Promise<SubjectCollection[]> {
  if (!subjectType || !subjectKey) return []
  if (subjectType === 'module') {
    return (MODULE_FLOW_PROFILES[subjectKey]?.collections ?? []).map((c) => ({
      key: c.key,
      label: c.label,
      fields: c.fields.map((f) => ({ key: f.key, label: f.label })),
    }))
  }
  // form_template: repeating sections / grid fields are a future pass.
  return []
}

/** Human label for a subject (module profile label or the app's name). */
export async function loadSubjectLabel(
  ctx: RequestContext,
  subjectType: string | null,
  subjectKey: string | null,
): Promise<string | null> {
  if (!subjectType || !subjectKey) return null
  if (subjectType === 'module') return MODULE_FLOW_PROFILES[subjectKey]?.label ?? subjectKey
  if (subjectType === 'form_template') {
    const [t] = await ctx.db((tx) =>
      tx
        .select({ name: formTemplates.name })
        .from(formTemplates)
        .where(eq(formTemplates.id, subjectKey))
        .limit(1),
    )
    return t?.name ?? 'App'
  }
  return null
}

/** Pickable record types for the New-template form: native modules + Builder apps. */
export async function listSubjectOptions(
  ctx: RequestContext,
): Promise<{ modules: SubjectOption[]; apps: SubjectOption[] }> {
  const modules: SubjectOption[] = Object.values(MODULE_FLOW_PROFILES).map((p) => ({
    type: 'module',
    key: p.subjectKey,
    label: p.label,
  }))
  const apps = await ctx.db((tx) =>
    tx
      .select({ key: formTemplates.id, label: formTemplates.name })
      .from(formTemplates)
      .where(isNull(formTemplates.deletedAt)),
  )
  return {
    modules,
    apps: apps.map((a) => ({ type: 'form_template' as const, key: a.key, label: a.label })),
  }
}
