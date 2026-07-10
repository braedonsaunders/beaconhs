// Public person-badge verification page — the live training transcript behind
// the QR on a printed ID badge. Resolved purely from the badge token; no auth.
// Mobile-first: the common reader is a supervisor scanning a card at the gate.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import {
  attachments,
  departments,
  people,
  tenants,
  trainingCourses,
  trainingRecords,
  trainingSkillAssignments,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { latestTrainingRecordOnly } from '@/lib/training-latest'

export const dynamic = 'force-dynamic'

const EXPIRING_DAYS = 60

type CredentialRow = {
  name: string
  code: string | null
  completedOn: string
  expiresOn: string | null
}

type SkillRow = {
  name: string
  grantedOn: string
  expiresOn: string | null
}

type Resolved = {
  personName: string
  employeeNo: string | null
  jobTitle: string | null
  departmentName: string | null
  personActive: boolean
  photoUrl: string | null
  tenantName: string
  tenantLogoUrl: string | null
  credentials: CredentialRow[]
  skills: SkillRow[]
}

async function resolveToken(token: string): Promise<Resolved | null> {
  // Public, unauthenticated lookup: a badge token can belong to ANY tenant, so
  // this runs on the BYPASSRLS super pool — people + training tables enforce
  // FORCE ROW LEVEL SECURITY and would otherwise return nothing.
  return withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({
        person: people,
        tenant: tenants,
        departmentName: departments.name,
        photoKey: attachments.r2Key,
      })
      .from(people)
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .leftJoin(attachments, eq(attachments.id, people.photoAttachmentId))
      .innerJoin(tenants, eq(tenants.id, people.tenantId))
      .where(and(eq(people.badgeToken, token), isNull(people.deletedAt)))
      .limit(1)
    if (!row) return null

    // Current standing only: the latest record per course (retraining
    // supersedes older records — same rule as the compliance matrix).
    const records = await tx
      .select({
        name: trainingCourses.name,
        code: trainingCourses.code,
        completedOn: trainingRecords.completedOn,
        expiresOn: trainingRecords.expiresOn,
      })
      .from(trainingRecords)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(
        and(
          eq(trainingRecords.personId, row.person.id),
          isNull(trainingRecords.deletedAt),
          latestTrainingRecordOnly(),
        ),
      )
      .orderBy(asc(trainingCourses.name))

    const skills = await tx
      .select({
        name: trainingSkillTypes.name,
        grantedOn: trainingSkillAssignments.grantedOn,
        expiresOn: trainingSkillAssignments.expiresOn,
      })
      .from(trainingSkillAssignments)
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
      .where(
        and(
          eq(trainingSkillAssignments.personId, row.person.id),
          isNull(trainingSkillAssignments.deletedAt),
        ),
      )
      .orderBy(asc(trainingSkillTypes.name))

    return {
      personName: `${row.person.firstName} ${row.person.lastName}`,
      employeeNo: row.person.employeeNo,
      jobTitle: row.person.jobTitle,
      departmentName: row.departmentName,
      personActive: row.person.status === 'active',
      photoUrl: row.photoKey ? publicUrl(row.photoKey) : null,
      tenantName: row.tenant.name,
      tenantLogoUrl: row.tenant.branding.logoUrl ?? null,
      credentials: records,
      skills,
    }
  })
}

// Date-only strings compare correctly as strings; parsing yyyy-mm-dd as a Date
// would flip status at UTC midnight on the final valid day.
type Standing = 'valid' | 'expiring' | 'expired'

function standingFor(expiresOn: string | null, todayIso: string, soonIso: string): Standing {
  if (!expiresOn) return 'valid'
  if (expiresOn < todayIso) return 'expired'
  if (expiresOn <= soonIso) return 'expiring'
  return 'valid'
}

function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDay(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return value
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
}

const STANDING_STYLE: Record<Standing, { chip: string; label: string }> = {
  valid: { chip: 'bg-emerald-100 text-emerald-800', label: 'Valid' },
  expiring: { chip: 'bg-amber-100 text-amber-800', label: 'Expiring soon' },
  expired: { chip: 'bg-red-100 text-red-700', label: 'Expired' },
}

function StandingChip({ standing }: { standing: Standing }) {
  const s = STANDING_STYLE[standing]
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.chip}`}
    >
      {s.label}
    </span>
  )
}

function CredentialCard({
  title,
  code,
  completedOn,
  expiresOn,
  standing,
}: {
  title: string
  code?: string | null
  completedOn?: string
  expiresOn: string | null
  standing: Standing
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          {code ? <div className="mt-0.5 font-mono text-[11px] text-slate-400">{code}</div> : null}
        </div>
        <StandingChip standing={standing} />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
        {completedOn ? (
          <span>
            Completed <span className="font-medium text-slate-700">{formatDay(completedOn)}</span>
          </span>
        ) : null}
        <span>
          {expiresOn ? (
            <>
              Expires <span className="font-medium text-slate-700">{formatDay(expiresOn)}</span>
            </>
          ) : (
            'Does not expire'
          )}
        </span>
      </div>
    </div>
  )
}

export default async function VerifyPersonPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await resolveToken(token)

  if (!result) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-red-700">Badge not recognized</h1>
          <p className="mt-1 text-sm text-slate-600">
            This badge token is unknown or invalid. Ask the badge holder&apos;s employer to verify
            their training directly.
          </p>
        </div>
      </main>
    )
  }

  const todayIso = new Date().toISOString().slice(0, 10)
  const soonIso = isoDaysFromNow(EXPIRING_DAYS)
  const credentials = result.credentials.map((c) => ({
    ...c,
    standing: standingFor(c.expiresOn, todayIso, soonIso),
  }))
  const skills = result.skills.map((s) => ({
    ...s,
    standing: standingFor(s.expiresOn, todayIso, soonIso),
  }))
  const current = credentials.filter((c) => c.standing !== 'expired')
  const expired = credentials.filter((c) => c.standing === 'expired')
  const validCount = [...credentials, ...skills].filter((c) => c.standing === 'valid').length
  const expiringCount = [...credentials, ...skills].filter((c) => c.standing === 'expiring').length
  const expiredCount = [...credentials, ...skills].filter((c) => c.standing === 'expired').length

  return (
    <main className="min-h-screen bg-slate-100 pb-10">
      {/* Identity header */}
      <header className="bg-slate-900 px-4 pt-8 pb-14 text-white">
        <div className="mx-auto max-w-md">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-slate-200">
              LIVE TRAINING RECORD
            </span>
            <span className="text-[11px] text-slate-400">As of {formatDay(todayIso)}</span>
          </div>
          <div className="mt-5 flex items-center gap-4">
            {result.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.photoUrl}
                alt=""
                className="h-20 w-20 shrink-0 rounded-2xl border-2 border-white/20 object-cover"
              />
            ) : (
              <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border-2 border-white/20 bg-white/10 text-2xl font-bold">
                {result.personName
                  .split(/\s+/)
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold">{result.personName}</h1>
              <div className="mt-0.5 truncate text-sm text-slate-300">
                {[result.jobTitle, result.departmentName].filter(Boolean).join(' · ') || '—'}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                {result.employeeNo ? <span className="font-mono">#{result.employeeNo}</span> : null}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    result.personActive
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-red-500/15 text-red-300'
                  }`}
                >
                  {result.personActive ? 'Active employee' : 'Not active'}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
            {result.tenantLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.tenantLogoUrl}
                alt=""
                className="h-6 max-w-28 rounded bg-white object-contain px-1 py-0.5"
              />
            ) : null}
            <span>Issued by {result.tenantName}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-8 max-w-md space-y-6 px-4">
        {/* Standing summary */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <div className="text-xl font-bold text-emerald-600">{validCount}</div>
            <div className="text-[11px] font-medium text-slate-500">Valid</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <div className="text-xl font-bold text-amber-600">{expiringCount}</div>
            <div className="text-[11px] font-medium text-slate-500">Expiring soon</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <div className="text-xl font-bold text-red-600">{expiredCount}</div>
            <div className="text-[11px] font-medium text-slate-500">Expired</div>
          </div>
        </div>

        {/* Current training */}
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Current training
          </h2>
          {current.length ? (
            current.map((c, i) => (
              <CredentialCard
                key={`${c.name}-${i}`}
                title={c.name}
                code={c.code}
                completedOn={c.completedOn}
                expiresOn={c.expiresOn}
                standing={c.standing}
              />
            ))
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
              No current training on record.
            </div>
          )}
        </section>

        {/* Skills */}
        {skills.length ? (
          <section className="space-y-2">
            <h2 className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Skills &amp; qualifications
            </h2>
            {skills.map((s, i) => (
              <CredentialCard
                key={`${s.name}-${i}`}
                title={s.name}
                completedOn={s.grantedOn}
                expiresOn={s.expiresOn}
                standing={s.standing}
              />
            ))}
          </section>
        ) : null}

        {/* Expired */}
        {expired.length ? (
          <section className="space-y-2">
            <h2 className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Expired
            </h2>
            {expired.map((c, i) => (
              <CredentialCard
                key={`${c.name}-${i}`}
                title={c.name}
                code={c.code}
                completedOn={c.completedOn}
                expiresOn={c.expiresOn}
                standing={c.standing}
              />
            ))}
          </section>
        ) : null}

        <p className="px-1 text-center text-[11px] leading-relaxed text-slate-400">
          This page shows the live training standing for the badge holder as recorded by{' '}
          {result.tenantName}. It updates automatically — no printed copy required.
        </p>
      </div>
    </main>
  )
}
