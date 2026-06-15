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
import { PageContainer } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'
import { createSafeDistanceRecord } from '../_actions'
import {
  pressureUnitLabel,
  SAFE_DISTANCE_METHOD_LABELS,
  SAFE_DISTANCE_METHOD_SUBTITLES,
} from '../_lib'

export const metadata = { title: 'New pressure-test assessment' }

export default async function NewSafeDistancePage() {
  const ctx = await requireRequestContext()

  const { sites, supervisors, operators } = await ctx.db(async (tx) => {
    const s = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
      .limit(200)
    const sv = await tx
      .select({ id: tenantUsers.id, name: tenantUsers.displayName, email: userTable.email })
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
          title="New pressure-test assessment"
          description="Name the system and pick a method and unit. You'll add pipe segments on the next screen."
          back={{ href: '/tools/safe-distance', label: 'All assessments' }}
        />

        <Alert>
          <AlertTitle>About this calculator</AlertTitle>
          <AlertDescription>
            Estimates the minimum personnel stand-off for a pneumatic (compressed-gas) pressure
            test. All three standards are computed for every assessment — the chosen method governs
            the headline figure. Always confirm against the governing test procedure.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Assessment details</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createSafeDistanceRecord} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name">System name</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue=""
                  placeholder='e.g. North header — 6" line'
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="method">Calculation method</Label>
                  <Select id="method" name="method" defaultValue="nasa">
                    {(['nasa', 'asme', 'lloyds'] as const).map((m) => (
                      <option key={m} value={m}>
                        {SAFE_DISTANCE_METHOD_LABELS[m]} — {SAFE_DISTANCE_METHOD_SUBTITLES[m]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unit">Result unit</Label>
                  <Select id="unit" name="unit" defaultValue="imperial">
                    <option value="imperial">Imperial (psi / ft³ / ft)</option>
                    <option value="metric">Metric (bar / m³ / m)</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="testPressure">Test pressure</Label>
                  <Input
                    id="testPressure"
                    name="testPressure"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue="0"
                    placeholder={pressureUnitLabel('imperial')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={2}
                  placeholder="System, medium, test procedure reference…"
                />
              </div>

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

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <Button type="submit">Create &amp; add segments</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
