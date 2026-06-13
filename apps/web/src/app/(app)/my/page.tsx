// "My" landing page — a hub of personal views for the signed-in user.
//
// Each tile is a one-glance summary card linking to a per-entity list filtered
// by the active membership. Counts are computed in a single DB transaction
// using the request context's bound executor, so they obey RLS like every
// other page.

import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  ListChecks,
  Radiation,
  User,
} from 'lucide-react'
import { and, count, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@beaconhs/ui'
import {
  correctiveActions,
  documentAcknowledgments,
  documents,
  hazidAssessments,
  incidents,
  inspectionRecords,
  people,
  trainingAudienceAssignmentRecords,
  trainingRecords,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Workspace' }
export const dynamic = 'force-dynamic'

type Tile = {
  href: string
  label: string
  description: string
  icon: typeof User
  count?: number
  hint?: string
  // Optional accent so urgent tiles (overdue tasks etc) stand out.
  accent?: 'amber' | 'red' | 'teal'
}

export default async function MyLandingPage() {
  const ctx = await requireRequestContext()
  const membershipId = ctx.membership?.id ?? null

  const counts = await ctx.db(async (tx) => {
    // Person row tied to this user (if any) — drives training + ack +
    // toolbox-attendee queries that work off `people.id`.
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, ctx.userId))
      .limit(1)
    const personId = person?.id ?? null

    const today = new Date()
    const ninetyDays = new Date()
    ninetyDays.setDate(ninetyDays.getDate() + 90)

    // ---- incidents reported by me ----------------------------------------
    const incidentsPromise: Promise<number> = membershipId
      ? tx
          .select({ c: count() })
          .from(incidents)
          .where(
            and(eq(incidents.reportedByTenantUserId, membershipId), isNull(incidents.deletedAt)),
          )
          .then((r) => Number(r[0]?.c ?? 0))
      : Promise.resolve(0)

    // ---- hazard assessments started by me --------------------------------
    const hazardAssessmentsPromise: Promise<number> = membershipId
      ? tx
          .select({ c: count() })
          .from(hazidAssessments)
          .where(
            and(
              eq(hazidAssessments.reportedByTenantUserId, membershipId),
              isNull(hazidAssessments.deletedAt),
            ),
          )
          .then((r) => Number(r[0]?.c ?? 0))
      : Promise.resolve(0)

    // ---- open / overdue tasks assigned to me -----------------------------
    const tasksWhere = membershipId
      ? and(
          eq(correctiveActions.ownerTenantUserId, membershipId),
          isNull(correctiveActions.deletedAt),
          // 'open' or 'in_progress' or 'pending_verification' — anything not
          // closed/cancelled counts as still-on-my-plate.
          or(
            eq(correctiveActions.status, 'open'),
            eq(correctiveActions.status, 'in_progress'),
            eq(correctiveActions.status, 'pending_verification'),
          ),
        )
      : undefined

    const openTasksPromise: Promise<number> = membershipId
      ? tx
          .select({ c: count() })
          .from(correctiveActions)
          .where(tasksWhere as SQL<unknown>)
          .then((r) => Number(r[0]?.c ?? 0))
      : Promise.resolve(0)

    const overdueTasksPromise: Promise<number> = membershipId
      ? tx
          .select({ c: count() })
          .from(correctiveActions)
          .where(
            and(
              tasksWhere as SQL<unknown>,
              lte(correctiveActions.dueOn, today.toISOString().slice(0, 10)),
            ) as SQL<unknown>,
          )
          .then((r) => Number(r[0]?.c ?? 0))
      : Promise.resolve(0)

    // ---- training records + upcoming expirations -------------------------
    const trainingRecordsPromise: Promise<number> = personId
      ? tx
          .select({ c: count() })
          .from(trainingRecords)
          .where(and(eq(trainingRecords.personId, personId), isNull(trainingRecords.deletedAt)))
          .then((r) => Number(r[0]?.c ?? 0))
      : Promise.resolve(0)

    const trainingExpiringPromise: Promise<number> = personId
      ? tx
          .select({ c: count() })
          .from(trainingRecords)
          .where(
            and(
              eq(trainingRecords.personId, personId),
              isNull(trainingRecords.deletedAt),
              gte(trainingRecords.expiresOn, today.toISOString().slice(0, 10)),
              lte(trainingRecords.expiresOn, ninetyDays.toISOString().slice(0, 10)),
            ),
          )
          .then((r) => Number(r[0]?.c ?? 0))
      : Promise.resolve(0)

    const trainingAssignedPromise: Promise<number> = personId
      ? tx
          .select({ c: count() })
          .from(trainingAudienceAssignmentRecords)
          .where(
            and(
              eq(trainingAudienceAssignmentRecords.personId, personId),
              or(
                eq(trainingAudienceAssignmentRecords.status, 'pending'),
                eq(trainingAudienceAssignmentRecords.status, 'in_progress'),
                eq(trainingAudienceAssignmentRecords.status, 'overdue'),
              ) as SQL<unknown>,
            ),
          )
          .then((r) => Number(r[0]?.c ?? 0))
      : Promise.resolve(0)

    // ---- inspections this user inspected ---------------------------------
    const inspectionsPromise: Promise<number> = membershipId
      ? tx
          .select({ c: count() })
          .from(inspectionRecords)
          .where(
            and(
              eq(inspectionRecords.inspectorTenantUserId, membershipId),
              isNull(inspectionRecords.deletedAt),
            ),
          )
          .then((r) => Number(r[0]?.c ?? 0))
      : Promise.resolve(0)

    // ---- documents acknowledged / outstanding ----------------------------
    // We surface "outstanding documents" rather than total — this is what
    // someone actually needs to act on.
    let docsOutstanding = 0
    if (personId) {
      // documents published, not yet acknowledged by this person at the
      // latest version. We approximate with a left-anti style: count
      // published docs minus those with an ack for this person.
      const [totalRow] = await tx
        .select({ c: count() })
        .from(documents)
        .where(and(eq(documents.status, 'published'), isNull(documents.deletedAt)))
      const total = Number(totalRow?.c ?? 0)
      const [ackedRow] = await tx
        .select({
          c: sql<number>`count(distinct ${documentAcknowledgments.documentId})`,
        })
        .from(documentAcknowledgments)
        .where(eq(documentAcknowledgments.personId, personId))
      const acked = Number(ackedRow?.c ?? 0)
      docsOutstanding = Math.max(0, total - acked)
    }

    return {
      incidents: await incidentsPromise,
      hazardAssessments: await hazardAssessmentsPromise,
      openTasks: await openTasksPromise,
      overdueTasks: await overdueTasksPromise,
      trainingRecords: await trainingRecordsPromise,
      trainingExpiring: await trainingExpiringPromise,
      trainingAssigned: await trainingAssignedPromise,
      inspections: await inspectionsPromise,
      docsOutstanding,
    }
  })

  const tiles: Tile[] = [
    {
      href: '/my/incidents',
      label: 'My incidents',
      description: 'Incidents you reported.',
      icon: AlertTriangle,
      count: counts.incidents,
    },
    {
      href: '/my/hazard-assessments',
      label: 'My assessments',
      description: 'Hazard assessments you started.',
      icon: Radiation,
      count: counts.hazardAssessments,
    },
    {
      href: '/my/tasks',
      label: 'My tasks',
      description: 'Open corrective actions assigned to you.',
      icon: ListChecks,
      count: counts.openTasks,
      hint: counts.overdueTasks > 0 ? `${counts.overdueTasks} overdue` : undefined,
      accent: counts.overdueTasks > 0 ? 'red' : counts.openTasks > 0 ? 'amber' : undefined,
    },
    {
      href: '/my/training',
      label: 'My training',
      description: 'Courses, records, upcoming expirations, and assignments.',
      icon: GraduationCap,
      count: counts.trainingRecords,
      hint:
        counts.trainingExpiring > 0
          ? `${counts.trainingExpiring} expiring in 90d`
          : counts.trainingAssigned > 0
            ? `${counts.trainingAssigned} assigned`
            : undefined,
      accent: counts.trainingExpiring > 0 ? 'amber' : undefined,
    },
    {
      href: '/my/inspections',
      label: 'My inspections',
      description: 'Inspection records you carried out.',
      icon: ClipboardList,
      count: counts.inspections,
    },
    {
      href: '/my/acknowledgments',
      label: 'My acknowledgments',
      description: 'Documents you have read and signed.',
      icon: CheckCircle2,
      hint:
        counts.docsOutstanding > 0 ? `${counts.docsOutstanding} outstanding` : 'None outstanding',
      accent: counts.docsOutstanding > 0 ? 'amber' : 'teal',
    },
  ]

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Workspace"
          description={
            ctx.membership?.displayName
              ? `Personal views for ${ctx.membership.displayName}.`
              : 'Personal views for your account.'
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => (
            <Link key={tile.href} href={tile.href as any} className="group block">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader className="flex-row items-start gap-3 pb-2">
                  <div
                    className={
                      tile.accent === 'red'
                        ? 'flex h-9 w-9 items-center justify-center rounded-md bg-red-100 text-red-700'
                        : tile.accent === 'amber'
                          ? 'flex h-9 w-9 items-center justify-center rounded-md bg-amber-100 text-amber-700'
                          : tile.accent === 'teal'
                            ? 'flex h-9 w-9 items-center justify-center rounded-md bg-teal-100 text-teal-700'
                            : 'flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600'
                    }
                  >
                    <tile.icon size={18} />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base">{tile.label}</CardTitle>
                    <CardDescription>{tile.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="pt-1">
                  <div className="flex items-baseline gap-2">
                    {typeof tile.count === 'number' ? (
                      <span className="text-2xl font-semibold text-slate-900 tabular-nums">
                        {tile.count}
                      </span>
                    ) : null}
                    {tile.hint ? (
                      <Badge
                        variant={
                          tile.accent === 'red'
                            ? 'destructive'
                            : tile.accent === 'amber'
                              ? 'warning'
                              : tile.accent === 'teal'
                                ? 'success'
                                : 'secondary'
                        }
                        className="font-normal"
                      >
                        {tile.hint}
                      </Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
