import type { FormSchemaV1 } from '@beaconhs/forms-core'

export type MoveFieldResult = { schema: FormSchemaV1; moved: boolean; blocked: boolean }

export function moveFieldToSection(
  source: FormSchemaV1,
  fieldId: string,
  fromSectionId: string,
  toSectionId: string,
  index: number,
): MoveFieldResult {
  const schema = structuredClone(source)
  const from = schema.sections.find((section) => section.id === fromSectionId)
  const to = schema.sections.find((section) => section.id === toSectionId)
  if (!from || !to) return { schema: source, moved: false, blocked: false }
  const fieldIndex = from.fields.findIndex((field) => field.id === fieldId)
  if (fieldIndex < 0) return { schema: source, moved: false, blocked: false }
  if (from.id !== to.id && Boolean(from.repeating) !== Boolean(to.repeating))
    return { schema: source, moved: false, blocked: true }
  if (from.id === to.id) {
    const [field] = from.fields.splice(fieldIndex, 1)
    if (!field) return { schema: source, moved: false, blocked: false }
    const target = Math.max(0, Math.min(index, from.fields.length))
    from.fields.splice(target, 0, field)
    return { schema, moved: true, blocked: false }
  }
  const [field] = from.fields.splice(fieldIndex, 1)
  if (!field) return { schema: source, moved: false, blocked: false }
  const previous = from.canvas?.items.find((item) => item.i === fieldId)
  to.fields.splice(Math.max(0, Math.min(index, to.fields.length)), 0, field)
  if (from.canvas)
    from.canvas = { ...from.canvas, items: from.canvas.items.filter((item) => item.i !== fieldId) }
  if (to.canvas) {
    const fallback = {
      x: 0,
      y: to.canvas.items.reduce((bottom, item) => Math.max(bottom, item.y + item.h), 0),
      w: 6,
      h: 2,
    }
    to.canvas = {
      ...to.canvas,
      items: [...to.canvas.items, { i: fieldId, ...(previous ?? fallback) }],
    }
  }
  return { schema, moved: true, blocked: false }
}
