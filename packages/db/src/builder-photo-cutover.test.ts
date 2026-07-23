import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../drizzle/0025_unify_builder_photo_fields.sql', import.meta.url),
  'utf8',
)

describe('Builder photo clean cutover', () => {
  it('migrates response data before removing legacy schema types', () => {
    const responseCutover = migration.indexOf('UPDATE form_responses AS response')
    const schemaCutover = migration.indexOf('UPDATE form_template_versions')

    expect(responseCutover).toBeGreaterThan(0)
    expect(schemaCutover).toBeGreaterThan(responseCutover)
    expect(migration).toContain(
      "legacy_type IN ('photo', 'photo_upload', 'photo_ai', 'photo_annotated')",
    )
    expect(migration).toContain("jsonb_build_object('attachments', photo_rows)")
  })

  it('preserves AI results and converts numbered markers into visible annotations', () => {
    expect(migration).toContain("'analysis', raw_value->'analysis'")
    expect(migration).toContain("'analyzedAt', raw_value->'analyzedAt'")
    expect(migration).toContain("legacy_type = 'photo_annotated'")
    expect(migration).toContain("'type', 'text'")
    expect(migration).toContain("'color', '#e11d48'")
  })

  it('keeps every historically valid multi-photo response within its old limit', () => {
    expect(migration).toContain("jsonb_build_object('multiple', true, 'maxFiles', 50)")
    expect(migration).toContain("jsonb_build_object('multiple', false, 'maxFiles', 1)")
  })

  it('migrates top-level, repeating-row, and autosaved draft values', () => {
    expect(migration).toContain('migrated_row := jsonb_set')
    expect(migration).toContain('beaconhs_migrate_builder_photo_draft')
    expect(migration).toContain(
      "RETURN draft_data || jsonb_build_object('values', migrated_values, 'rows', migrated_rows)",
    )
  })

  it('rewrites existing Builder PDF photo bindings without overwriting templates', () => {
    expect(migration).toContain("template.record_subject_type = 'form_template'")
    expect(migration).toContain("concat('{{#each ', target.field_id, '_photos}}')")
    expect(migration).toContain("concat('{{', target.field_id, '_text}}')")
    expect(migration).not.toContain('DELETE FROM pdf_templates')
  })
})
