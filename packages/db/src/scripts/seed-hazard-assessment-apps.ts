import { and, count, eq, max } from 'drizzle-orm'
import { createSuperClient } from '../client'
import {
  hazidAssessmentTypeApps,
  hazidAssessmentTypePPE,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
  hazidHazardSets,
  tenants,
} from '../schema'
import { seedHazardAssessmentAppTemplates } from '../seed/hazard-assessment-app-templates'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

const BASE_PPE: Array<[string, boolean]> = [
  ['Hard hat', true],
  ['Safety glasses', true],
  ['Steel-toe boots', true],
  ['Hi-vis vest', true],
  ['Gloves (task-specific)', false],
  ['Hearing protection', false],
]

const BASE_QUESTIONS = [
  'Have all crew members reviewed this JSHA?',
  'Have all hazards been assessed and controlled?',
  'Is the work area clear and properly barricaded?',
  'Are emergency procedures known to all crew?',
]

async function hazardSetId(tx: Tx, tenantId: string, name: string) {
  const [row] = await tx
    .select({ id: hazidHazardSets.id })
    .from(hazidHazardSets)
    .where(and(eq(hazidHazardSets.tenantId, tenantId), eq(hazidHazardSets.name, name)))
    .limit(1)
  return row?.id ?? null
}

async function ensureType(
  tx: Tx,
  tenantId: string,
  args: {
    name: string
    description: string
    defaultHazardSetId: string | null
  },
) {
  const [existing] = await tx
    .select({ id: hazidAssessmentTypes.id })
    .from(hazidAssessmentTypes)
    .where(
      and(eq(hazidAssessmentTypes.tenantId, tenantId), eq(hazidAssessmentTypes.name, args.name)),
    )
    .limit(1)
  if (existing) {
    await tx
      .update(hazidAssessmentTypes)
      .set({
        description: args.description,
        hasTasks: true,
        hasHazards: true,
        hasPPE: true,
        hasQuestions: true,
        hasWAH: false,
        defaultHazardSetId: args.defaultHazardSetId,
      })
      .where(eq(hazidAssessmentTypes.id, existing.id))
    return existing.id
  }

  const [created] = await tx
    .insert(hazidAssessmentTypes)
    .values({
      tenantId,
      name: args.name,
      description: args.description,
      style: 'task_based',
      hasTasks: true,
      hasHazards: true,
      hasPPE: true,
      hasQuestions: true,
      hasWAH: false,
      defaultHazardSetId: args.defaultHazardSetId,
      availableToGroupIds: [],
    })
    .returning({ id: hazidAssessmentTypes.id })
  if (!created) throw new Error(`Failed to create ${args.name}`)
  return created.id
}

async function ensureDefaults(
  tx: Tx,
  tenantId: string,
  typeId: string,
  extraPpe: Array<[string, boolean]>,
  extraQuestion: string,
) {
  const [ppeCount] = await tx
    .select({ c: count() })
    .from(hazidAssessmentTypePPE)
    .where(eq(hazidAssessmentTypePPE.typeId, typeId))
  if (Number(ppeCount?.c ?? 0) === 0) {
    await tx.insert(hazidAssessmentTypePPE).values(
      [...BASE_PPE, ...extraPpe].map(([name, required], i) => ({
        tenantId,
        typeId,
        name,
        required,
        entityOrder: i + 1,
      })),
    )
  }

  const [questionCount] = await tx
    .select({ c: count() })
    .from(hazidAssessmentTypeQuestions)
    .where(eq(hazidAssessmentTypeQuestions.typeId, typeId))
  if (Number(questionCount?.c ?? 0) === 0) {
    await tx.insert(hazidAssessmentTypeQuestions).values(
      [...BASE_QUESTIONS, extraQuestion].map((question, i) => ({
        tenantId,
        typeId,
        question,
        questionType: 'yes_no' as const,
        requiresYes: true,
        entityOrder: i + 1,
      })),
    )
  }
}

async function ensureTypeApp(
  tx: Tx,
  tenantId: string,
  args: {
    typeId: string
    templateId: string
    key: string
    label: string
    description: string
    config: Record<string, unknown>
  },
) {
  const [existing] = await tx
    .select({ id: hazidAssessmentTypeApps.id })
    .from(hazidAssessmentTypeApps)
    .where(
      and(
        eq(hazidAssessmentTypeApps.typeId, args.typeId),
        eq(hazidAssessmentTypeApps.key, args.key),
      ),
    )
    .limit(1)
  if (existing) {
    await tx
      .update(hazidAssessmentTypeApps)
      .set({
        templateId: args.templateId,
        label: args.label,
        description: args.description,
        required: true,
        autoCreate: true,
        config: args.config,
      })
      .where(eq(hazidAssessmentTypeApps.id, existing.id))
    return
  }

  const [maxOrder] = await tx
    .select({ m: max(hazidAssessmentTypeApps.entityOrder) })
    .from(hazidAssessmentTypeApps)
    .where(eq(hazidAssessmentTypeApps.typeId, args.typeId))
  await tx.insert(hazidAssessmentTypeApps).values({
    tenantId,
    typeId: args.typeId,
    templateId: args.templateId,
    key: args.key,
    label: args.label,
    description: args.description,
    required: true,
    autoCreate: true,
    entityOrder: (maxOrder?.m ?? 0) + 1,
    config: args.config,
  })
}

async function main() {
  const { db, sql } = createSuperClient({ max: 1 })
  try {
    const tenantRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
    for (const tenant of tenantRows) {
      await db.transaction(async (tx) => {
        const templates = await seedHazardAssessmentAppTemplates(tx, tenant.id)
        const confinedTypeId = await ensureType(tx, tenant.id, {
          name: 'Confined Space JSHA',
          description:
            'Core JSHA plus an embedded confined-space entry app for readings, entry log, rescue planning, and sign-off.',
          defaultHazardSetId: await hazardSetId(tx, tenant.id, 'Confined space entry'),
        })
        const arcFlashTypeId = await ensureType(tx, tenant.id, {
          name: 'Arc Flash JSHA',
          description:
            'Core JSHA plus an embedded arc-flash work-plan app for electrical boundaries, PPE, controls, and qualified sign-off.',
          defaultHazardSetId: await hazardSetId(tx, tenant.id, 'Welding / hot work'),
        })

        await ensureDefaults(
          tx,
          tenant.id,
          confinedTypeId,
          [
            ['Respiratory protection (if required by atmosphere/SDS)', false],
            ['Retrieval harness / lifeline', true],
          ],
          'Has the confined-space entry app been completed before entry?',
        )
        await ensureDefaults(
          tx,
          tenant.id,
          arcFlashTypeId,
          [
            ['Arc-rated FR clothing', true],
            ['Voltage-rated gloves with leather protectors', true],
          ],
          'Has the arc-flash work-plan app been completed before electrical work?',
        )

        await ensureTypeApp(tx, tenant.id, {
          typeId: confinedTypeId,
          templateId: templates.confinedSpaceTemplateId,
          key: 'confined_space_entry_plan',
          label: 'Confined-space entry app',
          description: 'Readings, entry log, rescue planning, and entry sign-off.',
          config: { replacesNativeSection: 'confined_space' },
        })
        await ensureTypeApp(tx, tenant.id, {
          typeId: arcFlashTypeId,
          templateId: templates.arcFlashTemplateId,
          key: 'arc_flash_work_plan',
          label: 'Arc-flash work-plan app',
          description: 'Electrical study details, controls, PPE, boundaries, and sign-off.',
          config: { replacesNativeSection: 'arc_flash' },
        })
      })
      console.log(`Seeded hazard assessment apps for ${tenant.name}`)
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
