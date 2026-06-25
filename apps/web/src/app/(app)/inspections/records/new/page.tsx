import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, eq, isNull } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  inspectionRecords,
  inspectionTypeCriteria,
  inspectionTypes,
  orgUnits,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { materialiseCriteriaForRecord, nextInspectionReference } from '../../_lib'
import { localDatetimeValue } from '../../_datetime'
import { TypePicker, type TypeCard } from './_type-picker'

export const metadata = { title: 'New inspection' }
export const dynamic = 'force-dynamic'

async function createRecord(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const typeId = String(formData.get('typeId') ?? '').trim()
  if (!typeId) throw new Error('Inspection type is required')

  const type = await ctx.db(async (tx) => {
    const [t] = await tx
      .select()
      .from(inspectionTypes)
      .where(eq(inspectionTypes.id, typeId))
      .limit(1)
    return t
  })
  if (!type) throw new Error('Inspection type not found')

  const occurredAtRaw = String(formData.get('occurredAt') ?? '')
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date()
  if (Number.isNaN(occurredAt.getTime())) throw new Error('Invalid occurred date')

  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const foremanText = String(formData.get('foremanText') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null

  if (type.requiresForeman && !foremanText) {
    throw new Error('This inspection type requires a foreman name.')
  }

  const reference = await nextInspectionReference(ctx, occurredAt)

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(inspectionRecords)
      .values({
        tenantId: ctx.tenantId,
        reference,
        typeId,
        status: 'draft',
        occurredAt,
        siteOrgUnitId,
        foremanText,
        foremanPersonIds: [],
        inspectorTenantUserId: ctx.membership?.id ?? null,
        notes,
      })
      .returning()
    return r
  })

  if (!row) throw new Error('Failed to create inspection record')

  const materialised = await materialiseCriteriaForRecord(ctx, row.id, typeId)

  await recordAudit(ctx, {
    entityType: 'inspection_record',
    entityId: row.id,
    action: 'create',
    summary: `Started ${row.reference} (${type.name}) — materialised ${materialised} criteria`,
    after: { reference: row.reference, typeId, occurredAt, siteOrgUnitId },
  })

  await runModuleFlows(ctx, { moduleKey: 'inspections', event: 'on_create', subjectId: row.id })

  revalidatePath('/inspections/records')
  redirect(`/inspections/records/${row.id}`)
}

export default async function NewInspectionRecordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const presetTypeId = pickString(sp.typeId)
  const ctx = await requireRequestContext()

  const { types, sites } = await ctx.db(async (tx) => {
    const tt = await tx
      .select({
        id: inspectionTypes.id,
        name: inspectionTypes.name,
        description: inspectionTypes.description,
        requiresForeman: inspectionTypes.requiresForeman,
        requiresCustomerSignature: inspectionTypes.requiresCustomerSignature,
        criteriaCount: count(inspectionTypeCriteria.id),
      })
      .from(inspectionTypes)
      .leftJoin(inspectionTypeCriteria, eq(inspectionTypeCriteria.typeId, inspectionTypes.id))
      .where(eq(inspectionTypes.isPublished, true))
      .groupBy(inspectionTypes.id)
      .orderBy(asc(inspectionTypes.name))
    const ss = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(and(eq(orgUnits.level, 'site'), isNull(orgUnits.deletedAt)))
      .orderBy(asc(orgUnits.name))
    return { types: tt, sites: ss }
  })

  const nowLocal = localDatetimeValue()
  const typeCards: TypeCard[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    criteriaCount: Number(t.criteriaCount ?? 0),
    requiresForeman: t.requiresForeman,
    requiresCustomerSignature: t.requiresCustomerSignature,
  }))

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/inspections/records', label: 'Back to inspection records' }}
          title="New inspection"
          subtitle="Pick a type, say where and when — every criterion is pre-loaded so you can start answering."
        />
        {types.length === 0 ? (
          <Alert variant="warning">
            <AlertTitle>No inspection types available</AlertTitle>
            <AlertDescription>
              You need at least one published{' '}
              <Link href="/inspections/types" className="text-teal-700 hover:underline">
                inspection type
              </Link>{' '}
              before you can start a record. Each type bundles the criteria the inspector answers.
            </AlertDescription>
          </Alert>
        ) : null}

        <form action={createRecord} className="space-y-6">
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  1 · Inspection type
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  The type decides which checks appear and what gets pre-filled.
                </p>
              </div>
              <TypePicker
                types={typeCards}
                name="typeId"
                defaultValue={presetTypeId ?? undefined}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  2 · Details
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Where the inspection happened and who ran the crew.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Occurred at" required>
                  <Input name="occurredAt" type="datetime-local" required defaultValue={nowLocal} />
                </Field>
                <Field label="Site">
                  <Select name="siteOrgUnitId" defaultValue="">
                    <option value="">—</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Foreman" className="sm:col-span-2">
                  <Input name="foremanText" placeholder="Crew foreman on shift" />
                </Field>
                <Field label="Notes" className="sm:col-span-2">
                  <Textarea
                    name="notes"
                    rows={3}
                    placeholder="Anything important the inspector should know"
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Button type="submit" disabled={types.length === 0}>
              Create inspection
            </Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
