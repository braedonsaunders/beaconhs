import { asc, eq } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { orgUnits, people, tenantUsers, user as userTable } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'
import { createSafeDistanceRecordForm } from '../_actions'
import {
  DRONE_DEFAULT_CLEARANCE_M,
  ELECTRICAL_TABLE,
  SAFE_DISTANCE_TYPE_LABELS,
  VEHICLE_DEFAULT_CLEARANCE_M,
} from '../_lib'
import { NewSafeDistanceForm } from './_form'

export const metadata = { title: 'New safe-distance assessment' }

export default async function NewSafeDistancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const presetType = pickString(sp.type) ?? 'electrical'
  const ctx = await requireRequestContext()

  const { sites, supervisors, operators } = await ctx.db(async (tx) => {
    const s = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
      .limit(200)
    const sv = await tx
      .select({
        id: tenantUsers.id,
        name: tenantUsers.displayName,
        email: userTable.email,
      })
      .from(tenantUsers)
      .leftJoin(userTable, eq(userTable.id, tenantUsers.userId))
      .where(eq(tenantUsers.status, 'active'))
      .orderBy(asc(tenantUsers.displayName))
      .limit(200)
    const op = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(500)
    return {
      sites: s,
      supervisors: sv.map((r) => ({
        id: r.id,
        name: r.name ?? '(unnamed)',
        email: r.email ?? undefined,
      })),
      operators: op.map((p) => ({
        id: p.id,
        name:
          `${p.lastName ?? ''}${p.lastName ? ', ' : ''}${p.firstName ?? ''}`.trim() || '(unnamed)',
        employeeNo: p.employeeNo,
      })),
    }
  })

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="New safe-distance assessment"
          description="Select an assessment type to calculate the minimum required distance."
          back={{ href: '/tools/safe-distance', label: 'All assessments' }}
        />

        <Alert>
          <AlertTitle>How required distance is calculated</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              <li>
                <strong>Electrical / overhead crane:</strong> IEEE C2 / CSA limits-of-approach table
                — pick a kV and the required clearance is set automatically.
              </li>
              <li>
                <strong>Drone:</strong> Transport Canada minimum {DRONE_DEFAULT_CLEARANCE_M} m from
                non-involved people.
              </li>
              <li>
                <strong>Vehicle:</strong> {VEHICLE_DEFAULT_CLEARANCE_M} m baseline stand-off.
              </li>
              <li>
                <strong>Other:</strong> enter the required distance manually.
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Assessment details</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createSafeDistanceRecordForm} className="space-y-5">
              <NewSafeDistanceForm initialType={presetType} />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="siteOrgUnitId">Site</Label>
                  <Select id="siteOrgUnitId" name="siteOrgUnitId">
                    <option value="">— No site —</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="supervisorTenantUserId">Supervisor (sign-off)</Label>
                  <PersonSelectField
                    name="supervisorTenantUserId"
                    defaultValue=""
                    options={supervisors.map((s) => ({
                      value: s.id,
                      label: s.name,
                      hint: s.email,
                    }))}
                    placeholder="Select a supervisor…"
                    clearable
                    emptyLabel="— None —"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="operatorPersonId">Operator</Label>
                  <PersonSelectField
                    name="operatorPersonId"
                    defaultValue=""
                    options={operators.map((p) => ({
                      value: p.id,
                      label: p.name,
                      hint: p.employeeNo ?? undefined,
                    }))}
                    placeholder="Select an operator…"
                    clearable
                    emptyLabel="— None —"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  placeholder="Additional context, controls in place, witnesses…"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <Button variant="outline" type="reset">
                  Reset
                </Button>
                <Button type="submit">Create assessment</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Electrical limits-of-approach reference</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-1">Voltage range (kV)</th>
                  <th className="px-2 py-1">Required distance (m)</th>
                </tr>
              </thead>
              <tbody>
                {ELECTRICAL_TABLE.map((row, i) => {
                  const lower = i === 0 ? 0 : ELECTRICAL_TABLE[i - 1]!.maxVoltageKv
                  const upperLabel = Number.isFinite(row.maxVoltageKv)
                    ? `< ${row.maxVoltageKv} kV`
                    : `≥ 750 kV`
                  return (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-1.5 text-slate-700 dark:text-slate-300">
                        {i === 0 ? `< ${row.maxVoltageKv} kV` : `${lower} – ${upperLabel}`}
                      </td>
                      <td className="px-2 py-1.5 font-medium text-slate-900 dark:text-slate-100">
                        {row.requiredDistanceM} m
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Source: IEEE C2 / CSA Z462 abbreviated limits of approach. Always check the local AHJ
              for jurisdiction-specific overrides.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

// The list of types is reused in the client form too, but the page-level
// const helps keep the page declaration tight.
export const SAFE_DISTANCE_TYPE_OPTIONS = Object.entries(SAFE_DISTANCE_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
)
