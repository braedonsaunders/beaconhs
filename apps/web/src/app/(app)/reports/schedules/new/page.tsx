import { asc } from 'drizzle-orm'
import {
  Button,
  Card,
  CardContent,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { reportDefinitions } from '@beaconhs/db/schema'
import { db, withSuperAdmin } from '@beaconhs/db'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { createSchedule } from './actions'

export const metadata = { title: 'Subscribe to report' }

export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRequestContext()
  const sp = await searchParams
  const presetDefinitionId = typeof sp.definitionId === 'string' ? sp.definitionId : undefined

  const definitions = await withSuperAdmin(db, (tx) =>
    tx.select().from(reportDefinitions).orderBy(asc(reportDefinitions.name)),
  )

  const defaultDef = definitions.find((d) => d.id === presetDefinitionId) ?? definitions[0]

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/reports', label: 'Back to reports' }}
          title="Subscribe to a report"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createSchedule} className="space-y-4">
              <Field label="Report" required>
                <Select name="definitionId" defaultValue={defaultDef?.id ?? ''}>
                  {definitions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.category ? ` (${d.category})` : ''}
                    </option>
                  ))}
                </Select>
                {defaultDef?.description ? (
                  <p className="mt-1 text-xs text-slate-500">{defaultDef.description}</p>
                ) : null}
              </Field>

              <Field label="Schedule name" required>
                <Input
                  name="name"
                  required
                  placeholder="e.g. Monday morning incidents"
                  defaultValue={defaultDef ? `${defaultDef.name} — weekly` : ''}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cadence" required>
                  <Select name="cadence" defaultValue="weekly">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </Select>
                </Field>
                <Field label="Timezone" required>
                  <Input name="timezone" required defaultValue="America/Toronto" />
                </Field>
                <Field label="Day of week (weekly)">
                  <Select name="dayOfWeek" defaultValue="1">
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </Select>
                </Field>
                <Field label="Day of month (monthly)">
                  <Input name="dayOfMonth" type="number" min={1} max={31} defaultValue={1} />
                </Field>
                <Field label="Hour (0-23)" required>
                  <Input name="hour" type="number" min={0} max={23} defaultValue={7} required />
                </Field>
                <Field label="Minute (0-59)" required>
                  <Input name="minute" type="number" min={0} max={59} defaultValue={0} required />
                </Field>
              </div>

              <Field label="Recipient emails (one per line, or comma-separated)">
                <Textarea
                  name="recipientEmails"
                  rows={3}
                  placeholder="hse@acme.com, manager@acme.com"
                />
              </Field>

              <Field label="Recipient user IDs (optional — resolved to emails at send)">
                <Textarea
                  name="recipientUserIds"
                  rows={2}
                  placeholder="User UUIDs, comma- or newline-separated"
                />
              </Field>

              <Field label="Filters (JSON)">
                <Textarea
                  name="filters"
                  rows={3}
                  placeholder='e.g. {"departmentId": "...", "siteOrgUnitId": "...", "rangeDays": 7}'
                  defaultValue="{}"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Optional. Filter shape depends on the report. Common keys: <code>rangeDays</code>,{' '}
                  <code>lookaheadDays</code>, <code>departmentId</code>, <code>siteOrgUnitId</code>.
                </p>
              </Field>

              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create schedule</Button>
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
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
