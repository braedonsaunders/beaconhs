import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
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
import { inspectionRecords, inspectionTypes, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import {
  materialiseCriteriaForRecord,
  nextInspectionReference,
} from '../../_lib'

export const metadata = { title: 'New inspection' }

async function createRecord(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const typeId = String(formData.get('typeId') ?? '').trim()
  if (!typeId) throw new Error('Inspection type is required')

  // Load the type so we can enforce its requires-foreman / requires-customer-sig flags.
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
  const customerSignerName = String(formData.get('customerSignerName') ?? '').trim() || null
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
        customerSignerName,
        notes,
      })
      .returning()
    return r
  })

  if (!row) throw new Error('Failed to create inspection record')

  // Materialise per-criterion rows from the type's linked banks
  const materialised = await materialiseCriteriaForRecord(ctx, row.id, typeId)

  await recordAudit(ctx, {
    entityType: 'inspection_record',
    entityId: row.id,
    action: 'create',
    summary: `Started ${row.reference} (${type.name}) — materialised ${materialised} criteria`,
    after: {
      reference: row.reference,
      typeId,
      occurredAt,
      siteOrgUnitId,
      criteriaMaterialised: materialised,
    },
  })

  revalidatePath('/inspections/records')
  redirect(`/inspections/records/${row.id}?tab=criteria`)
}

export default async function NewInspectionRecordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const presetTypeId = pickString(sp.typeId)
  const ctx = await requireRequestContext()

  const [types, sites] = await ctx.db(async (tx) => {
    const tt = await tx
      .select({
        id: inspectionTypes.id,
        name: inspectionTypes.name,
        requiresForeman: inspectionTypes.requiresForeman,
        requiresCustomerSignature: inspectionTypes.requiresCustomerSignature,
        description: inspectionTypes.description,
      })
      .from(inspectionTypes)
      .where(eq(inspectionTypes.isPublished, true))
      .orderBy(asc(inspectionTypes.name))
    const ss = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    return [tt, ss]
  })

  const nowLocal = new Date().toISOString().slice(0, 16)
  const defaultType =
    types.find((t) => t.id === presetTypeId) ?? types[0] ?? null

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/inspections/records', label: 'Back to inspection records' }}
          title="New inspection"
        />
        {types.length === 0 ? (
          <Alert variant="warning">
            <AlertTitle>No inspection types available</AlertTitle>
            <AlertDescription>
              You need at least one published{' '}
              <a href="/inspections/types" className="text-teal-700 hover:underline">
                inspection type
              </a>{' '}
              before you can start a record. Each type bundles the criteria the inspector will
              answer.
            </AlertDescription>
          </Alert>
        ) : null}
        {defaultType ? (
          <Alert variant="info">
            <AlertTitle>What happens after I submit?</AlertTitle>
            <AlertDescription>
              We'll create the record in draft state and pre-load every criterion from each bank
              linked to this type. You'll land on the criteria tab to start answering.
              {defaultType.requiresForeman ? (
                <>
                  <br />
                  <strong>Foreman name is required</strong> for this type.
                </>
              ) : null}
              {defaultType.requiresCustomerSignature ? (
                <>
                  <br />
                  <strong>Customer signature is required</strong> — capture it on the Signature
                  tab before closing.
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardContent className="pt-6">
            <form action={createRecord} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Inspection type" required className="sm:col-span-2">
                  <Select name="typeId" required defaultValue={defaultType?.id ?? ''}>
                    {!defaultType ? (
                      <option value="" disabled>
                        No types available
                      </option>
                    ) : null}
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Occurred at" required>
                  <Input
                    name="occurredAt"
                    type="datetime-local"
                    required
                    defaultValue={nowLocal}
                  />
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
                <Field
                  label={`Foreman ${defaultType?.requiresForeman ? '(required)' : '(optional)'}`}
                  className="sm:col-span-2"
                >
                  <Input
                    name="foremanText"
                    placeholder="Crew foreman on shift"
                    required={Boolean(defaultType?.requiresForeman)}
                  />
                </Field>
                {defaultType?.requiresCustomerSignature ? (
                  <Field label="Customer signer (name to print under signature)" className="sm:col-span-2">
                    <Input name="customerSignerName" placeholder="Customer rep on site" />
                  </Field>
                ) : null}
                <Field label="Notes" className="sm:col-span-2">
                  <Textarea
                    name="notes"
                    rows={3}
                    placeholder="Anything important the inspector should know"
                  />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit" disabled={types.length === 0}>
                  Create inspection
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
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
