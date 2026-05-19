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
import {
  inspectionAssignments,
  inspectionTypes,
  orgUnits,
  people,
  roles,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New inspection assignment' }

const FREQUENCIES = [
  { value: 'day', label: 'Daily', cron: '0 8 * * *' },
  { value: 'week', label: 'Weekly', cron: '0 8 * * 1' },
  { value: 'month', label: 'Monthly', cron: '0 8 1 * *' },
  { value: 'quarter', label: 'Quarterly', cron: '0 8 1 */3 *' },
  { value: 'year', label: 'Yearly', cron: '0 8 1 1 *' },
] as const

async function createAssignment(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const typeId = String(formData.get('typeId') ?? '').trim()
  if (!typeId) throw new Error('Inspection type is required')

  const frequency = String(formData.get('frequency') ?? 'week') as
    | 'day'
    | 'week'
    | 'month'
    | 'quarter'
    | 'year'
  const cron = String(formData.get('cron') ?? '').trim() || null
  const dueOffsetMinutes = Number(formData.get('dueOffsetMinutes') ?? 0) || null
  const quantityPerPeriod = Math.max(1, Number(formData.get('quantityPerPeriod') ?? 1))
  const compliantPercentage = Math.max(
    0,
    Math.min(100, Number(formData.get('compliantPercentage') ?? 100)),
  )
  const targetEverybody = String(formData.get('targetEverybody') ?? '') === 'on'
  const targetRoleKeys = (formData.getAll('targetRoleKeys') as string[])
    .map((s) => s.trim())
    .filter(Boolean)
  const targetPersonIds = (formData.getAll('targetPersonIds') as string[])
    .map((s) => s.trim())
    .filter(Boolean)
  const targetOrgUnitIds = (formData.getAll('targetOrgUnitIds') as string[])
    .map((s) => s.trim())
    .filter(Boolean)
  const notes = String(formData.get('notes') ?? '').trim() || null

  if (
    !targetEverybody &&
    targetRoleKeys.length === 0 &&
    targetPersonIds.length === 0 &&
    targetOrgUnitIds.length === 0
  ) {
    throw new Error('Pick at least one audience (everyone / role / person / site).')
  }

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(inspectionAssignments)
      .values({
        tenantId: ctx.tenantId,
        typeId,
        frequency,
        cron,
        dueOffsetMinutes,
        quantityPerPeriod,
        compliantPercentage,
        targetEverybody,
        targetRoleKeys,
        targetPersonIds,
        targetOrgUnitIds,
        notes,
        enabled: true,
        createdBy: ctx.userId,
      })
      .returning()
    return r
  })

  if (row) {
    await recordAudit(ctx, {
      entityType: 'inspection_assignment',
      entityId: row.id,
      action: 'create',
      summary: `Created assignment for inspection type ${typeId.slice(0, 8)} (${frequency})`,
      after: {
        typeId,
        frequency,
        quantityPerPeriod,
        compliantPercentage,
        targetEverybody,
        targetRoleKeys,
        targetPersonIds,
        targetOrgUnitIds,
      },
    })
  }
  revalidatePath('/inspections/assignments')
  if (row) redirect(`/inspections/assignments/${row.id}`)
  redirect('/inspections/assignments')
}

export default async function NewInspectionAssignmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const presetTypeId = pickString(sp.typeId)
  const ctx = await requireRequestContext()

  const [types, sites, allPeople, allRoles] = await ctx.db(async (tx) => {
    const tt = await tx
      .select({
        id: inspectionTypes.id,
        name: inspectionTypes.name,
        defaultCadence: inspectionTypes.defaultCadence,
      })
      .from(inspectionTypes)
      .where(eq(inspectionTypes.isPublished, true))
      .orderBy(asc(inspectionTypes.name))
    const ss = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const pp = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const rr = await tx
      .select({ key: roles.key, name: roles.name })
      .from(roles)
      .orderBy(asc(roles.name))
    return [tt, ss, pp, rr]
  })

  const defaultType = types.find((t) => t.id === presetTypeId) ?? types[0] ?? null
  const defaultFrequency =
    (defaultType?.defaultCadence as 'day' | 'week' | 'month' | 'quarter' | 'year' | null) ?? 'week'

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/inspections/assignments', label: 'Back to assignments' }}
          title="New inspection assignment"
        />
        {types.length === 0 ? (
          <Alert variant="warning">
            <AlertTitle>No inspection types available</AlertTitle>
            <AlertDescription>
              Create at least one published inspection type before scheduling an assignment.
            </AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardContent className="pt-6">
            <form action={createAssignment} className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Inspection type" required className="sm:col-span-2">
                  <Select name="typeId" required defaultValue={defaultType?.id ?? ''}>
                    {!defaultType ? <option value="" disabled>None</option> : null}
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Cadence" required>
                  <Select name="frequency" defaultValue={defaultFrequency}>
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label} ({f.cron})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Cron override (optional)">
                  <Input name="cron" placeholder="leave blank to use cadence default" />
                </Field>
                <Field label="Quantity per period" required>
                  <Input
                    name="quantityPerPeriod"
                    type="number"
                    min={1}
                    defaultValue={1}
                  />
                </Field>
                <Field label="Compliant threshold (%)">
                  <Input
                    name="compliantPercentage"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={100}
                  />
                </Field>
                <Field label="Due offset (minutes after fire)">
                  <Input
                    name="dueOffsetMinutes"
                    type="number"
                    placeholder="optional — e.g. 1440 = next day"
                  />
                </Field>
              </div>

              <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
                <legend className="px-1 text-xs font-medium text-slate-700">Audience</legend>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="targetEverybody"
                    className="h-4 w-4 rounded border-slate-300 text-teal-600"
                  />
                  Apply to everyone (active people)
                </label>

                <div>
                  <Label className="text-xs">Roles (hold cmd / ctrl to pick multiple)</Label>
                  <select
                    name="targetRoleKeys"
                    multiple
                    className="mt-1 min-h-[80px] w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                  >
                    {allRoles.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className="text-xs">Specific people</Label>
                  <select
                    name="targetPersonIds"
                    multiple
                    className="mt-1 min-h-[80px] w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                  >
                    {allPeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.firstName} {p.lastName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className="text-xs">Sites (people active on these sites)</Label>
                  <select
                    name="targetOrgUnitIds"
                    multiple
                    className="mt-1 min-h-[80px] w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
                  >
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </fieldset>

              <Field label="Notes">
                <Textarea name="notes" rows={2} placeholder="Internal context for this assignment" />
              </Field>

              <div className="flex items-center justify-end gap-2">
                <Button type="submit" disabled={types.length === 0}>
                  Create assignment
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
