import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { desc, eq } from 'drizzle-orm'
import { Timer } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
} from '@beaconhs/ui'
import { lwCheckins, lwSessions, orgUnits, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'

export const dynamic = 'force-dynamic'

const LW_TABS = ['overview', 'checkins'] as const
type LwTab = (typeof LW_TABS)[number]

async function manualCheckin(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const sessionId = String(formData.get('sessionId') ?? '')
  const session = await ctx.db(async (tx) => {
    const [s] = await tx.select().from(lwSessions).where(eq(lwSessions.id, sessionId)).limit(1)
    return s
  })
  if (!session) return
  const nextDue = new Date(Date.now() + session.intervalMinutes * 60 * 1000)
  await ctx.db(async (tx) => {
    await tx.insert(lwCheckins).values({
      tenantId: ctx.tenantId,
      sessionId,
      kind: 'manual',
    })
    await tx.update(lwSessions).set({ nextCheckinDueAt: nextDue }).where(eq(lwSessions.id, sessionId))
  })
  await recordAudit(ctx, {
    entityType: 'lw_session',
    entityId: sessionId,
    action: 'update',
    summary: 'Manual check-in',
  })
  revalidatePath(`/lone-worker/${sessionId}`)
}

async function endSession(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const sessionId = String(formData.get('sessionId') ?? '')
  await ctx.db((tx) =>
    tx.update(lwSessions).set({ status: 'completed', endedAt: new Date() }).where(eq(lwSessions.id, sessionId)),
  )
  await recordAudit(ctx, {
    entityType: 'lw_session',
    entityId: sessionId,
    action: 'update',
    summary: 'Session completed',
  })
  revalidatePath(`/lone-worker/${sessionId}`)
  revalidatePath('/lone-worker')
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Lone-worker · ${id.slice(0, 8)}` }
}

export default async function LoneWorkerSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: LwTab = pickActiveTab(sp, LW_TABS, 'overview')
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        session: lwSessions,
        site: orgUnits,
        worker: tenantUsers,
        workerAccount: user,
      })
      .from(lwSessions)
      .leftJoin(orgUnits, eq(orgUnits.id, lwSessions.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, lwSessions.workerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(lwSessions.id, id))
      .limit(1)
    if (!row) return null
    const checkins = await tx
      .select()
      .from(lwCheckins)
      .where(eq(lwCheckins.sessionId, id))
      .orderBy(desc(lwCheckins.recordedAt))
    return { ...row, checkins }
  })
  if (!data) notFound()
  const { session, site, workerAccount, checkins } = data
  const isActive = session.status === 'active'
  const overdue = isActive && new Date(session.nextCheckinDueAt).getTime() < Date.now()
  const minsUntilCheckin = Math.round((new Date(session.nextCheckinDueAt).getTime() - Date.now()) / 60_000)

  const basePath = `/lone-worker/${id}`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/lone-worker', label: 'Back to sessions' }}
          title={workerAccount?.name ?? 'Lone-worker session'}
          subtitle={session.task ?? 'No task description'}
          badge={
            <Badge variant={isActive ? 'success' : session.status === 'missed' ? 'destructive' : 'secondary'}>
              {session.status}
            </Badge>
          }
          actions={
            isActive ? (
              <>
                <form action={manualCheckin} className="inline">
                  <input type="hidden" name="sessionId" value={id} />
                  <Button type="submit">Check in</Button>
                </form>
                <form action={endSession} className="inline">
                  <input type="hidden" name="sessionId" value={id} />
                  <Button type="submit" variant="outline">End session</Button>
                </form>
              </>
            ) : null
          }
        />
      }
      alerts={
        overdue ? (
          <Alert variant="destructive">
            <AlertTitle>Check-in overdue</AlertTitle>
            <AlertDescription>
              Next check-in was due {Math.abs(minsUntilCheckin)} minute(s) ago. The scheduled-tick
              worker will escalate after the grace period.
            </AlertDescription>
          </Alert>
        ) : null
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'checkins', label: 'Check-ins', count: checkins.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
        <DetailGrid
          rows={[
            { label: 'Worker', value: workerAccount?.name ?? '—' },
            { label: 'Site', value: site?.name ?? '—' },
            { label: 'Started', value: new Date(session.startedAt).toLocaleString() },
            { label: 'Expected end', value: new Date(session.expectedEndAt).toLocaleString() },
            { label: 'Interval', value: `${session.intervalMinutes} min` },
            { label: 'Grace period', value: `${session.gracePeriodMinutes} min` },
            {
              label: 'Next check-in',
              value: (
                <span className={overdue ? 'font-medium text-red-700' : ''}>
                  {new Date(session.nextCheckinDueAt).toLocaleString()}{' '}
                  {isActive ? `(${minsUntilCheckin > 0 ? `in ${minsUntilCheckin}m` : `${Math.abs(minsUntilCheckin)}m overdue`})` : ''}
                </span>
              ),
            },
            { label: 'Ended', value: session.endedAt ? new Date(session.endedAt).toLocaleString() : '—' },
          ]}
        />
        ) : null}

        {active === 'checkins' ? (
        <Section title={`Check-in log (${checkins.length})`}>
          {checkins.length === 0 ? (
            <p className="text-sm text-slate-500">No check-ins yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {checkins.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <Timer size={14} className="text-slate-400" />
                    <span className="font-medium">{c.kind.replace('_', ' ')}</span>
                  </div>
                  <span className="text-xs text-slate-500">{new Date(c.recordedAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}
