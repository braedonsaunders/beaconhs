// Validation for everything a tenant can author on a brief. The JSON shapes
// live on the DB schema (@beaconhs/db/schema → briefs.ts); these schemas are
// the single gate in front of every write (studio, schedules, API).

import { z } from 'zod'
import type { BriefSpec, BriefWindowSpec } from '@beaconhs/db/schema'

export const BRIEF_LIMITS = {
  nameLength: 120,
  descriptionLength: 1_000,
  instructionsLength: 4_000,
  sections: 8,
  sectionTitleLength: 80,
  sectionGuidanceLength: 600,
  maxBulletsPerSection: 12,
  sources: 8,
  minWords: 120,
  maxWords: 2_500,
  lastNDays: 92,
  recipients: 200,
} as const

const sectionKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Section keys use lowercase letters, digits, and underscores')

export const briefSectionSchema = z.object({
  key: sectionKey,
  title: z.string().trim().min(1).max(BRIEF_LIMITS.sectionTitleLength),
  guidance: z.string().trim().max(BRIEF_LIMITS.sectionGuidanceLength),
  maxBullets: z.number().int().min(1).max(BRIEF_LIMITS.maxBulletsPerSection),
})

export const briefSourceConfigSchema = z.object({
  key: z.string().trim().min(1).max(80),
  params: z.record(z.string(), z.unknown()).default({}),
})

export const briefSpecSchema = z
  .object({
    version: z.literal(1),
    sources: z.array(briefSourceConfigSchema).min(1).max(BRIEF_LIMITS.sources),
    instructions: z.string().trim().max(BRIEF_LIMITS.instructionsLength),
    sections: z.array(briefSectionSchema).min(1).max(BRIEF_LIMITS.sections),
    targetWords: z.number().int().min(BRIEF_LIMITS.minWords).max(BRIEF_LIMITS.maxWords),
    tier: z.enum(['fast', 'smart']),
    emptyPolicy: z.enum(['send_notice', 'skip']),
    compareWithPrevious: z.boolean(),
  })
  .superRefine((spec, ctx) => {
    const keys = new Set<string>()
    for (const [index, section] of spec.sections.entries()) {
      if (keys.has(section.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', index, 'key'],
          message: 'Section keys must be unique',
        })
      }
      keys.add(section.key)
    }
    const sources = new Set<string>()
    for (const [index, source] of spec.sources.entries()) {
      if (sources.has(source.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sources', index, 'key'],
          message: 'Each data source can be added once',
        })
      }
      sources.add(source.key)
    }
  }) satisfies z.ZodType<BriefSpec>

export const briefWindowSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('previous_day') }),
  z.object({ mode: z.literal('previous_business_day') }),
  z.object({
    mode: z.literal('last_n_days'),
    days: z.number().int().min(1).max(BRIEF_LIMITS.lastNDays),
  }),
  z.object({ mode: z.literal('since_last_run') }),
]) satisfies z.ZodType<BriefWindowSpec>

export class BriefValidationError extends Error {
  override readonly name = 'BriefValidationError'
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid brief'
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

/** Parse an authored spec, throwing a readable BriefValidationError. */
export function parseBriefSpec(value: unknown): BriefSpec {
  const parsed = briefSpecSchema.safeParse(value)
  if (!parsed.success) throw new BriefValidationError(firstIssue(parsed.error))
  return parsed.data as BriefSpec
}

export function parseBriefWindow(value: unknown): BriefWindowSpec {
  const parsed = briefWindowSchema.safeParse(value)
  if (!parsed.success) throw new BriefValidationError(firstIssue(parsed.error))
  return parsed.data
}

/** A fresh spec for a blank brief. */
export function blankBriefSpec(): BriefSpec {
  return {
    version: 1,
    sources: [{ key: 'journals.entries', params: {} }],
    instructions: '',
    sections: [
      {
        key: 'summary',
        title: 'Summary',
        guidance: 'The most important points first.',
        maxBullets: 6,
      },
    ],
    targetWords: 400,
    tier: 'smart',
    emptyPolicy: 'send_notice',
    compareWithPrevious: false,
  }
}
