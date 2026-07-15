import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
// "My" landing page — a hub of personal views for the signed-in user.
//
// Each tile is a one-glance summary card linking to a per-entity list filtered
// by the active membership. Counts are computed in a single DB transaction
// using the request context's bound executor, so they obey RLS like every
// other page.

import Link from 'next/link'
import {
  AlertTriangle,
  ClipboardList,
  GraduationCap,
  ListChecks,
  PencilLine,
  Radiation,
  ShieldCheck,
  User,
  Wallet,
} from 'lucide-react'
import { and, count, eq, gte, isNull, lt, lte, or, type SQL } from 'drizzle-orm'
import { Badge, cn, PageHeader } from '@beaconhs/ui'
import {
  correctiveActions,
  hazidAssessments,
  incidents,
  inspectionRecords,
  people,
  trainingRecords,
  trainingSkillAssignments,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { latestTrainingRecordOnly } from '@/lib/training-latest'
import { PageContainer } from '@/components/page-layout'
import { personCompliance } from '../compliance/_hub'
import { loadInProgressEntries } from '../dashboard/_metrics'
import { WorkspaceNoIdentity } from './_no-identity'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_01ac914ec691a0') }
}
export const dynamic = 'force-dynamic'

// Every tile gets its own hue so the wall reads at a glance; urgency is
// carried by the hint badge, not the tile colour.
type Tone = 'rose' | 'amber' | 'teal' | 'violet' | 'sky' | 'emerald' | 'indigo'

const TONES: Record<Tone, { chip: string; ghost: string }> = {
  rose: {
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
    ghost: 'text-rose-500/10 dark:text-rose-400/15',
  },
  amber: {
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
    ghost: 'text-amber-500/10 dark:text-amber-400/15',
  },
  teal: {
    chip: 'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300',
    ghost: 'text-teal-500/10 dark:text-teal-400/15',
  },
  violet: {
    chip: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
    ghost: 'text-violet-500/10 dark:text-violet-400/15',
  },
  sky: {
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
    ghost: 'text-sky-500/10 dark:text-sky-400/15',
  },
  emerald: {
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    ghost: 'text-emerald-500/10 dark:text-emerald-400/15',
  },
  indigo: {
    chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
    ghost: 'text-indigo-500/10 dark:text-indigo-400/15',
  },
}

type Tile = {
  href: string
  label: string
  description: string
  icon: typeof User
  tone: Tone
  count?: number
  hint?: string
  hintVariant?: 'destructive' | 'warning' | 'success' | 'secondary'
}

export default async function MyLandingPage() {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  const membershipId = ctx.membership?.id ?? null

  const counts = await ctx.db(async (tx) => {
    // Person row tied to this user (if any) — drives training + ack +
    // toolbox-attendee queries that work off `people.id`.
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
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
              // Strictly before today — matches /my/tasks and /corrective-actions.
              lt(correctiveActions.dueOn, today.toISOString().slice(0, 10)),
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
              // Retraining supersedes older records for the same course — only
              // the latest one can be "expiring".
              latestTrainingRecordOnly(),
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

    // ---- wallet credentials (training records + granted skills) ----------
    const skillsPromise: Promise<number> = personId
      ? tx
          .select({ c: count() })
          .from(trainingSkillAssignments)
          .where(eq(trainingSkillAssignments.personId, personId))
          .then((r) => Number(r[0]?.c ?? 0))
      : Promise.resolve(0)

    // ---- unfinished work across modules (same data as the dashboard) -----
    const inProgressPromise = membershipId
      ? loadInProgressEntries(tx, membershipId)
      : Promise.resolve([])

    return {
      personId,
      inProgress: await inProgressPromise,
      incidents: await incidentsPromise,
      hazardAssessments: await hazardAssessmentsPromise,
      openTasks: await openTasksPromise,
      overdueTasks: await overdueTasksPromise,
      trainingRecords: await trainingRecordsPromise,
      trainingExpiring: await trainingExpiringPromise,
      inspections: await inspectionsPromise,
      skills: await skillsPromise,
    }
  })

  // A platform super-admin browsing a tenant has neither a membership nor a
  // linked person record — the personal Workspace has nothing to scope to, so
  // render one calm explanation instead of a wall of dead-end tiles.
  if (!membershipId && !counts.personId) {
    return (
      <PageContainer>
        <div className="space-y-5">
          <PageHeader
            title={tGenerated('m_01ac914ec691a0')}
            description={tGenerated('m_0b1ede3c320d3b')}
          />
          <WorkspaceNoIdentity reason="no-membership" noun="records, training, and credentials" />
        </div>
      </PageContainer>
    )
  }

  // Outstanding compliance assigned to this person (obligations scoreboard).
  const complianceRows = counts.personId ? await personCompliance(ctx, counts.personId) : []
  const complianceOutstanding = complianceRows.filter((r) => r.status !== 'completed').length
  const complianceUrgent = complianceRows.filter(
    (r) => r.status === 'overdue' || r.status === 'expiring',
  ).length
  const trainingAssigned = complianceRows.filter(
    (row) =>
      (row.kind === 'training' || row.kind === 'cert_requirement') &&
      (row.status === 'pending' ||
        row.status === 'in_progress' ||
        row.status === 'overdue' ||
        row.status === 'expiring'),
  ).length

  const inProgressCount = counts.inProgress.length

  const tiles: Tile[] = [
    {
      // Same unfinished-work feed as the dashboard "In progress" card; opens a
      // card view with one card per unfinished entry to resume.
      href: '/my/in-progress',
      label: 'In progress',
      description: 'Drafts and unfinished entries to resume.',
      icon: PencilLine,
      tone: 'amber',
      count: inProgressCount,
      hint: inProgressCount > 0 ? `${inProgressCount} to resume` : 'all caught up',
      hintVariant: inProgressCount > 0 ? 'warning' : 'success',
    },
    {
      href: '/compliance/mine',
      label: 'Compliance',
      description: 'Obligations assigned to you.',
      icon: ShieldCheck,
      tone: 'indigo',
      count: complianceOutstanding,
      hint:
        complianceUrgent > 0
          ? `${complianceUrgent} overdue`
          : complianceOutstanding > 0
            ? 'outstanding'
            : 'all clear',
      hintVariant:
        complianceUrgent > 0 ? 'destructive' : complianceOutstanding > 0 ? 'warning' : 'success',
    },
    {
      href: '/my/tasks',
      label: 'Tasks',
      description: 'Open corrective actions assigned to you.',
      icon: ListChecks,
      tone: 'teal',
      count: counts.openTasks,
      hint: counts.overdueTasks > 0 ? `${counts.overdueTasks} overdue` : undefined,
      hintVariant: counts.overdueTasks > 0 ? 'destructive' : undefined,
    },
    {
      href: '/my/training',
      label: 'Training',
      description: 'Records, expirations, and assignments.',
      icon: GraduationCap,
      tone: 'violet',
      count: counts.trainingRecords,
      hint:
        counts.trainingExpiring > 0
          ? `${counts.trainingExpiring} expiring in 90d`
          : trainingAssigned > 0
            ? `${trainingAssigned} assigned`
            : undefined,
      hintVariant: counts.trainingExpiring > 0 ? 'warning' : 'secondary',
    },
    {
      href: '/my/wallet',
      label: 'Wallet',
      description: 'Your certificates and credential cards.',
      icon: Wallet,
      tone: 'emerald',
      count: counts.trainingRecords + counts.skills,
      hint:
        counts.trainingRecords + counts.skills > 0
          ? `${counts.trainingRecords + counts.skills} card${
              counts.trainingRecords + counts.skills === 1 ? '' : 's'
            }`
          : undefined,
      hintVariant: 'secondary',
    },
    {
      href: '/my/incidents',
      label: 'Incidents',
      description: 'Incidents you reported.',
      icon: AlertTriangle,
      tone: 'rose',
      count: counts.incidents,
    },
    {
      href: '/my/hazard-assessments',
      label: 'Assessments',
      description: 'Hazard assessments you started.',
      icon: Radiation,
      tone: 'amber',
      count: counts.hazardAssessments,
    },
    {
      href: '/my/inspections',
      label: 'Inspections',
      description: 'Inspection records you carried out.',
      icon: ClipboardList,
      tone: 'sky',
      count: counts.inspections,
    },
  ]

  return (
    <PageContainer>
      <div className="space-y-5">
        <PageHeader
          title={tGenerated('m_01ac914ec691a0')}
          description={tGeneratedValue(
            ctx.membership?.displayName
              ? tGenerated('m_1f86a3a8b4cc6d', { value0: ctx.membership.displayName })
              : tGenerated('m_0b1ede3c320d3b'),
          )}
        />

        <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          <GeneratedValue
            value={tiles.map((tile) => {
              const tone = TONES[tile.tone]
              return (
                <Link
                  key={tile.href}
                  href={tile.href as never}
                  className="group relative flex h-full min-h-[10rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg sm:p-6 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                >
                  {/* oversized ghost icon bleeding off the corner */}
                  <tile.icon
                    aria-hidden
                    strokeWidth={1.5}
                    className={cn(
                      'pointer-events-none absolute -right-6 -bottom-7 h-36 w-36 -rotate-12 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6',
                      tone.ghost,
                    )}
                  />
                  <div className="relative flex h-full flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={cn(
                          'inline-flex h-11 w-11 items-center justify-center rounded-xl',
                          tone.chip,
                        )}
                      >
                        <tile.icon size={22} />
                      </span>
                      <GeneratedValue
                        value={
                          typeof tile.count === 'number' ? (
                            <div className="text-3xl font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                              <GeneratedValue value={tile.count.toLocaleString()} />
                            </div>
                          ) : null
                        }
                      />
                    </div>
                    <div className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                      <GeneratedValue value={tile.label} />
                    </div>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      <GeneratedValue value={tile.description} />
                    </p>
                    <GeneratedValue
                      value={
                        tile.hint ? (
                          <Badge
                            variant={tile.hintVariant ?? 'secondary'}
                            className="mt-auto w-fit font-normal"
                          >
                            <GeneratedValue value={tile.hint} />
                          </Badge>
                        ) : (
                          <div className="mt-auto" />
                        )
                      }
                    />
                  </div>
                </Link>
              )
            })}
          />
        </div>
      </div>
    </PageContainer>
  )
}
