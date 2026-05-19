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
import { lwSessions, orgUnits, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

export const metadata = { title: 'Start lone-worker session' }

async function startSession(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const workerTenantUserId = String(formData.get('workerTenantUserId') ?? '').trim()
  if (!workerTenantUserId) throw new Error('Worker is required')
  const supervisorTenantUserId = String(formData.get('supervisorTenantUserId') ?? '').trim() || null
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const task = String(formData.get('task') ?? '').trim() || null
  const intervalMinutes = Math.max(5, Number(formData.get('intervalMinutes') ?? '30') || 30)
  const gracePeriodMinutes = Math.max(1, Number(formData.get('gracePeriodMinutes') ?? '10') || 10)
  const durationMinutes = Math.max(intervalMinutes, Number(formData.get('durationMinutes') ?? '120') || 120)
  const now = new Date()
  const expectedEndAt = new Date(now.getTime() + durationMinutes * 60 * 1000)
  const nextCheckinDueAt = new Date(now.getTime() + intervalMinutes * 60 * 1000)

  const [row] = await ctx.db((tx) =>
    tx
      .insert(lwSessions)
      .values({
        tenantId: ctx.tenantId,
        workerTenantUserId,
        supervisorTenantUserId,
        siteOrgUnitId,
        task,
        intervalMinutes,
        gracePeriodMinutes,
        expectedEndAt,
        nextCheckinDueAt,
        status: 'active',
      })
      .returning(),
  )
  revalidatePath('/lone-worker')
  if (row) redirect(`/lone-worker/${row.id}`)
  redirect('/lone-worker')
}

export default async function NewLoneWorkerPage() {
  const ctx = await requireRequestContext()
  const [sites, members] = await ctx.db(async (tx) => {
    const s = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const m = await tx
      .select({ id: tenantUsers.id, name: user.name, email: user.email })
      .from(tenantUsers)
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(tenantUsers.status, 'active'))
      .orderBy(asc(user.name))
    return [s, m] as const
  })

  return (
    <div className="max-w-2xl space-y-6">
      <DetailHeader
        back={{ href: '/lone-worker', label: 'Back to sessions' }}
        title="Start lone-worker session"
      />
      <Alert variant="info">
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>
          The scheduled-tick worker checks every minute. If a check-in is missed past the grace
          period the session is marked <code>missed</code> and the supervisor is notified.
        </AlertDescription>
      </Alert>
      <Card>
        <CardContent className="pt-6">
          <form action={startSession} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Worker" required className="sm:col-span-2">
                <Select name="workerTenantUserId" required defaultValue="">
                  <option value="">— select —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.email})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Supervisor">
                <Select name="supervisorTenantUserId" defaultValue="">
                  <option value="">—</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
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
              <Field label="Task" className="sm:col-span-2">
                <Textarea name="task" rows={2} placeholder="What you're doing alone" />
              </Field>
              <Field label="Check-in interval (min)" required>
                <Input name="intervalMinutes" type="number" min="5" defaultValue="30" required />
              </Field>
              <Field label="Grace period (min)" required>
                <Input name="gracePeriodMinutes" type="number" min="1" defaultValue="10" required />
              </Field>
              <Field label="Expected duration (min)" required className="sm:col-span-2">
                <Input name="durationMinutes" type="number" min="15" defaultValue="120" required />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit">Start session</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
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
