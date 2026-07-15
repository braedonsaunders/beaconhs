// Public person-badge verification page — the live training transcript behind
// the QR on a printed ID badge. Resolved purely from the badge token; no auth.
// Mobile-first: the common reader is a supervisor scanning a card at the gate.
// Every row opens the rendered wallet card for that credential.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { db, primaryPersonTitleName, withSuperAdmin } from '@beaconhs/db'
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
import { presignGet, resolveTenantLogoUrl } from '@beaconhs/storage'
import { RawImage } from '@/components/raw-image'
import { latestTrainingRecordOnly } from '@/lib/training-latest'
import { activeTenantPredicate } from '@/lib/active-tenant'
import { EXPIRING_DAYS, formatDay, isoDaysFromNow, standingFor, todayIsoDate } from './_format'
import { TranscriptList, type TranscriptItem } from './_transcript-list'

export const dynamic = 'force-dynamic'

type Resolved = {
  personName: string
  employeeNo: string | null
  jobTitle: string | null
  departmentName: string | null
  personActive: boolean
  photoUrl: string | null
  tenantName: string
  tenantLogoUrl: string | null
  credentials: {
    id: string
    name: string
    code: string | null
    completedOn: string
    expiresOn: string | null
  }[]
  skills: { id: string; name: string; grantedOn: string; expiresOn: string | null }[]
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
        jobTitle: primaryPersonTitleName(people.id, people.tenantId),
      })
      .from(people)
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .leftJoin(attachments, eq(attachments.id, people.photoAttachmentId))
      .innerJoin(tenants, eq(tenants.id, people.tenantId))
      .where(and(eq(people.badgeToken, token), isNull(people.deletedAt), activeTenantPredicate()))
      .limit(1)
    if (!row) return null

    // Current standing only: the latest record per course (retraining
    // supersedes older records — same rule as the compliance matrix).
    const records = await tx
      .select({
        id: trainingRecords.id,
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
        id: trainingSkillAssignments.id,
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
      jobTitle: row.jobTitle,
      departmentName: row.departmentName,
      personActive: row.person.status === 'active',
      photoUrl: row.photoKey
        ? await presignGet({ key: row.photoKey, expiresInSeconds: 300 })
        : null,
      tenantName: row.tenant.name,
      tenantLogoUrl: await resolveTenantLogoUrl({
        tenantId: row.tenant.id,
        logoUrl: row.tenant.branding.logoUrl,
        expiresInSeconds: 300,
      }),
      credentials: records,
      skills,
    }
  })
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

  const todayIso = todayIsoDate()
  const soonIso = isoDaysFromNow(EXPIRING_DAYS)
  const items: TranscriptItem[] = [
    ...result.credentials.map((c) => ({
      key: `t-${c.id}`,
      kind: 'training' as const,
      name: c.name,
      code: c.code,
      completedOn: c.completedOn,
      expiresOn: c.expiresOn,
      standing: standingFor(c.expiresOn, todayIso, soonIso),
      href: `/verify/person/${token}/record/${c.id}`,
    })),
    ...result.skills.map((s) => ({
      key: `s-${s.id}`,
      kind: 'skill' as const,
      name: s.name,
      code: null,
      completedOn: s.grantedOn,
      expiresOn: s.expiresOn,
      standing: standingFor(s.expiresOn, todayIso, soonIso),
      href: `/verify/person/${token}/skill/${s.id}`,
    })),
  ]
  const validCount = items.filter((i) => i.standing === 'valid').length
  const expiringCount = items.filter((i) => i.standing === 'expiring').length
  const expiredCount = items.filter((i) => i.standing === 'expired').length

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
              <RawImage
                src={result.photoUrl}
                alt=""
                optimizationReason="ephemeral"
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
              <RawImage
                src={result.tenantLogoUrl}
                alt=""
                optimizationReason="tenant-origin"
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

        <TranscriptList items={items} />

        <p className="px-1 text-center text-[11px] leading-relaxed text-slate-400">
          This page shows the live training standing for the badge holder as recorded by{' '}
          {result.tenantName}. It updates automatically — no printed copy required.
        </p>
      </div>
    </main>
  )
}
