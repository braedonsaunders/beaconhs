import 'server-only'

// Resolve the full field set + the pickable record types for email templates.
// Native modules and Builder apps are treated the SAME — both are "subjects".

import { desc, eq, isNull } from 'drizzle-orm'
import { formTemplateVersions, formTemplates } from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import type { RequestContext } from '@beaconhs/tenant'
import { MODULE_FLOW_PROFILES } from './module-profiles'
import {
  SKIP_FIELD_TYPES,
  hasImageCompanion,
  hasPhotosCompanion,
  hasTextCompanion,
  isAttachmentArrayField,
  labelText,
} from './form-subject-values'

export type SubjectFieldOption = { key: string; label: string }
export type SubjectOption = { type: 'module' | 'form_template'; key: string; label: string }
/** A repeating child collection exposed for {{#each}} tables. */
export type SubjectCollection = { key: string; label: string; fields: SubjectFieldOption[] }

/** Latest schema version for a Builder app (palette source of truth). */
async function loadLatestFormSchema(
  ctx: RequestContext,
  templateId: string,
): Promise<FormSchemaV1 | null> {
  const [ver] = await ctx.db((tx) =>
    tx
      .select({ schema: formTemplateVersions.schema })
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, templateId))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1),
  )
  return (ver?.schema as FormSchemaV1 | undefined) ?? null
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
    const schema = await loadLatestFormSchema(ctx, subjectKey)
    if (!schema) return []
    const out: SubjectFieldOption[] = []
    for (const sec of schema.sections ?? []) {
      for (const f of sec.fields ?? []) {
        if (SKIP_FIELD_TYPES.has(f.type)) continue
        const label = labelText(f.label, f.id)
        out.push({ key: f.id, label })
        // Companion keys mirror the form flow adapter's loadValues():
        // repeating-section rows keep raw values only, so companions apply to
        // top-level fields alone.
        if (sec.repeating) continue
        if (hasTextCompanion(f.type)) out.push({ key: `${f.id}_text`, label: `${label} (text)` })
        if (hasImageCompanion(f.type))
          out.push({ key: `${f.id}_image`, label: `${label} (image URL)` })
      }
    }
    out.push({ key: 'compliance_score', label: 'Compliance score' })
    out.push({ key: 'compliance_status', label: 'Compliance status' })
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
  if (subjectType === 'form_template') {
    const schema = await loadLatestFormSchema(ctx, subjectKey)
    if (!schema) return []
    const out: SubjectCollection[] = []
    const photoFields: SubjectFieldOption[] = [
      { key: 'url', label: 'File URL' },
      { key: 'filename', label: 'Filename' },
    ]
    for (const sec of schema.sections ?? []) {
      // Repeating sections: the response stores the rows array at the section
      // id, each row keyed by the section's field ids.
      if (sec.repeating) {
        const fields = (sec.fields ?? [])
          .filter((f) => !SKIP_FIELD_TYPES.has(f.type))
          .map((f) => ({ key: f.id, label: labelText(f.label, f.id) }))
        if (fields.length > 0) {
          out.push({ key: sec.id, label: labelText(sec.title, sec.id), fields })
        }
        continue
      }
      for (const f of sec.fields ?? []) {
        const label = labelText(f.label, f.id)
        // Photo/file fields: raw AttachedFile rows already carry {url, filename}.
        if (isAttachmentArrayField(f.type)) {
          out.push({ key: f.id, label, fields: photoFields })
          continue
        }
        // photo_ai / photo_annotated: nested attachments flattened by the
        // adapter into a `<id>_photos` companion collection.
        if (hasPhotosCompanion(f.type)) {
          out.push({ key: `${f.id}_photos`, label: `${label} (photos)`, fields: photoFields })
          continue
        }
        // Table fields: rows keyed by column key.
        if (f.type === 'table') {
          const cfg = (f.config ?? {}) as { columns?: { key: string; label?: string }[] }
          const columns = cfg.columns ?? []
          if (columns.length > 0) {
            out.push({
              key: f.id,
              label,
              fields: columns.map((c) => ({ key: c.key, label: c.label || c.key })),
            })
          }
        }
      }
    }
    return out
  }
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
