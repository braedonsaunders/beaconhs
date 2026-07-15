import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
          <h1 className="text-lg font-semibold text-red-700">
            <GeneratedText id="m_063993120a3d54" />
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            <GeneratedText id="m_0aecbf978560b4" />
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
              <GeneratedText id="m_1dab33d6429c73" />
            </span>
            <span className="text-[11px] text-slate-400">
              <GeneratedText id="m_0167c7275331b2" /> <GeneratedValue value={formatDay(todayIso)} />
            </span>
          </div>
          <div className="mt-5 flex items-center gap-4">
            <GeneratedValue
              value={
                result.photoUrl ? (
                  <RawImage
                    src={result.photoUrl}
                    alt=""
                    optimizationReason="ephemeral"
                    className="h-20 w-20 shrink-0 rounded-2xl border-2 border-white/20 object-cover"
                  />
                ) : (
                  <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border-2 border-white/20 bg-white/10 text-2xl font-bold">
                    <GeneratedValue
                      value={result.personName
                        .split(/\s+/)
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join('')}
                    />
                  </div>
                )
              }
            />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold">
                <GeneratedValue value={result.personName} />
              </h1>
              <div className="mt-0.5 truncate text-sm text-slate-300">
                <GeneratedValue
                  value={
                    [result.jobTitle, result.departmentName].filter(Boolean).join(' · ') || '—'
                  }
                />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <GeneratedValue
                  value={
                    result.employeeNo ? (
                      <span className="font-mono">
                        #<GeneratedValue value={result.employeeNo} />
                      </span>
                    ) : null
                  }
                />
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    result.personActive
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-red-500/15 text-red-300'
                  }`}
                >
                  <GeneratedValue
                    value={
                      result.personActive ? (
                        <GeneratedText id="m_1d15bf8a5a470e" />
                      ) : (
                        <GeneratedText id="m_022d99d12be272" />
                      )
                    }
                  />
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
            <GeneratedValue
              value={
                result.tenantLogoUrl ? (
                  <RawImage
                    src={result.tenantLogoUrl}
                    alt=""
                    optimizationReason="tenant-origin"
                    className="h-6 max-w-28 rounded bg-white object-contain px-1 py-0.5"
                  />
                ) : null
              }
            />
            <span>
              <GeneratedText id="m_113cf4908ce58e" /> <GeneratedValue value={result.tenantName} />
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-8 max-w-md space-y-6 px-4">
        {/* Standing summary */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <div className="text-xl font-bold text-emerald-600">
              <GeneratedValue value={validCount} />
            </div>
            <div className="text-[11px] font-medium text-slate-500">
              <GeneratedText id="m_1e418d0475450c" />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <div className="text-xl font-bold text-amber-600">
              <GeneratedValue value={expiringCount} />
            </div>
            <div className="text-[11px] font-medium text-slate-500">
              <GeneratedText id="m_07f7dccfd917d5" />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
            <div className="text-xl font-bold text-red-600">
              <GeneratedValue value={expiredCount} />
            </div>
            <div className="text-[11px] font-medium text-slate-500">
              <GeneratedText id="m_13f7150c94b182" />
            </div>
          </div>
        </div>

        <TranscriptList items={items} />

        <p className="px-1 text-center text-[11px] leading-relaxed text-slate-400">
          <GeneratedText id="m_1ae623e918b603" />
          <GeneratedValue value={' '} />
          <GeneratedValue value={result.tenantName} />
          <GeneratedText id="m_09fbd9c7322039" />
        </p>
      </div>
    </main>
  )
}
