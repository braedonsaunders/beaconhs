import { z } from 'zod'
import { KIND_META, OBLIGATION_KINDS } from './_meta'

const audienceKind = z.enum(['everyone', 'role', 'trade', 'department', 'person', 'org_unit'])
const uuid = z.string().uuid()

const recurrenceSchema = z
  .object({
    kind: z.enum(['one_time', 'frequency', 'cron']),
    frequency: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
    cron: z.string().trim().min(1).max(256).optional(),
    quantity: z.number().int().min(1).max(10_000).optional(),
    compliantPercentage: z.number().min(0).max(100).optional(),
    dueOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .refine((value) => {
        const date = new Date(`${value}T00:00:00.000Z`)
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
      }, 'Due date is invalid')
      .optional(),
    remindBeforeDays: z.number().int().min(0).max(3_650).optional(),
    dueOffsetMinutes: z.number().int().min(0).max(525_600).optional(),
  })
  .strict()

const obligationInputSchema = z
  .object({
    kind: z.enum(OBLIGATION_KINDS),
    title: z.string().trim().max(500),
    notes: z.string().trim().max(20_000).nullable().optional(),
    audience: z
      .array(
        z
          .object({
            type: audienceKind,
            entityKey: z.string().trim().max(256),
          })
          .strict(),
      )
      .max(500),
    recurrence: recurrenceSchema,
    inspectionTypeId: uuid.optional(),
    documentId: uuid.optional(),
    trainingItemKind: z.enum(['course', 'assessment_type']).optional(),
    courseId: uuid.optional(),
    assessmentTypeId: uuid.optional(),
    certItemKind: z.enum(['course', 'skill']).optional(),
    skillTypeId: uuid.optional(),
    formTemplateId: uuid.optional(),
    equipmentTypeId: uuid.optional(),
    ppeTypeId: uuid.optional(),
    jobTitleId: uuid.optional(),
  })
  .strict()

export type ObligationInput = z.infer<typeof obligationInputSchema>

type ObligationInputParseResult =
  { ok: true; value: ObligationInput } | { ok: false; error: string }

export function parseObligationInput(raw: unknown): ObligationInputParseResult {
  const parsed = obligationInputSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'The obligation details are invalid' }

  const input = parsed.data
  const meta = KIND_META[input.kind]
  if (!meta.audience && input.audience.length > 0) {
    return { ok: false, error: 'This obligation kind does not accept an audience' }
  }

  const allowed = new Set(meta.audienceTypes)
  const normalizedAudience: ObligationInput['audience'] = []
  const seen = new Set<string>()
  for (const item of input.audience) {
    if (!allowed.has(item.type)) {
      return { ok: false, error: `${item.type.replace('_', ' ')} is not valid for this obligation` }
    }
    const entityKey = item.type === 'everyone' ? '' : item.entityKey
    if (item.type !== 'everyone' && !entityKey) {
      return { ok: false, error: 'Every audience row must have a target' }
    }
    const key = `${item.type}\u0000${entityKey}`
    if (seen.has(key)) continue
    seen.add(key)
    normalizedAudience.push({ type: item.type, entityKey })
  }

  return { ok: true, value: { ...input, audience: normalizedAudience } }
}
