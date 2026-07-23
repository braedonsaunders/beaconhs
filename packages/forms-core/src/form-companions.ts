// Which merge keys a form response's value map carries per field type — the
// SINGLE source of truth for the companion-key conventions shared by:
//   • the web form flow adapter (WRITES the companions into loadValues()),
//   • the merge-field palette (subject-fields.ts in the web app),
//   • the PDF template generator (pdf-template-html.ts — REFERENCES them).
// Conventions:
//   {{<fieldId>}}          the raw stored value
//   {{<fieldId>_text}}     human-readable text (pickers → names, joins, …)
//   {{<fieldId>_image}}    an embeddable image URL (sketch; signature values
//                          are projected to a signed URL at render time)
//   {{#each <fieldId>}}    file fields — AttachedFile {url, filename}
//   {{#each <fieldId>_photos}}  photo attachments with rendered markup
//   {{#each <sectionId>}}  repeating-section rows keyed by field id
//   {{#each <fieldId>}}    table-field rows keyed by column key

import { entityKindForPicker } from './entity-attrs'
import type { I18nString } from './schema'
import { DEFAULT_LOCALE, localizeText, type AppLocale } from '@beaconhs/i18n'

/** Content-only field types that carry no mergeable value. */
export const SKIP_FIELD_TYPES = new Set(['heading', 'paragraph', 'divider', 'metric'])

/** Resolve an i18n label using the active user and tenant fallback locales. */
export function labelText(
  l: I18nString | undefined,
  fallback: string,
  locale: AppLocale = DEFAULT_LOCALE,
  tenantDefault: AppLocale = DEFAULT_LOCALE,
): string {
  return localizeText(l, locale, fallback, tenantDefault)
}

// Field types whose raw stored value is unreadable in a document — these get a
// `<id>_text` companion in the value map and the palette.
const TEXT_COMPANION_TYPES = new Set([
  'multi_person_picker',
  'multi_select',
  'checkbox_group',
  'ranking',
  'yes_no_comment',
  'gps',
  'matrix',
  'address',
  'risk_matrix',
  'typed_attestation',
  'data_table',
  'photo',
  'datetime',
])

export function hasTextCompanion(type: string): boolean {
  return TEXT_COMPANION_TYPES.has(type) || entityKindForPicker(type) !== null
}

/** Sketch stores `{url}` — the URL is exposed as `<id>_image`. */
export function hasImageCompanion(type: string): boolean {
  return type === 'sketch'
}

/** Object-valued photo fields whose attachments nest under `.attachments`. */
export function hasPhotosCompanion(type: string): boolean {
  return type === 'photo'
}

/** Array-of-AttachedFile fields — raw rows already carry {url, filename}. */
export function isAttachmentArrayField(type: string): boolean {
  return ['file', 'video', 'audio'].includes(type)
}
