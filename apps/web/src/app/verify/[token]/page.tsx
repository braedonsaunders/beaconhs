// Public credential-verification page. Resolved purely from a token; no auth.
// A token belongs to either a course certificate (training_certificates) or
// a skill certificate (training_skill_certificates) — try both.

import { eq } from 'drizzle-orm'
import { Card, CardContent } from '@beaconhs/ui'
import { db, withSuperAdmin } from '@beaconhs/db'
import {
  people,
  tenants,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillCertificates,
  trainingSkillTypes,
} from '@beaconhs/db/schema'

export const dynamic = 'force-dynamic'

type Resolved = {
  kind: 'course' | 'skill'
  personName: string
  credentialName: string
  credentialCode: string | null
  issuedOn: string
  expiresOn: string | null
  issuerName: string
  authorityName: string | null
  revoked: boolean
}

async function resolveToken(token: string): Promise<Resolved | null> {
  // Public, unauthenticated lookup: a verify token can belong to ANY tenant, so
  // this runs on the BYPASSRLS super pool — the training_* + people tables it
  // joins all enforce FORCE ROW LEVEL SECURITY and would otherwise return nothing.
  return withSuperAdmin(db, async (tx) => {
    const [course] = await tx
      .select({
        cert: trainingCertificates,
        record: trainingRecords,
        course: trainingCourses,
        person: people,
        tenant: tenants,
      })
      .from(trainingCertificates)
      .innerJoin(trainingRecords, eq(trainingRecords.id, trainingCertificates.recordId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(tenants, eq(tenants.id, trainingCertificates.tenantId))
      .where(eq(trainingCertificates.verifyToken, token))
      .limit(1)
    if (course) {
      return {
        kind: 'course' as const,
        personName: `${course.person.firstName} ${course.person.lastName}`,
        credentialName: course.course.name,
        credentialCode: course.course.code,
        issuedOn: course.record.completedOn,
        expiresOn: course.record.expiresOn,
        issuerName: course.tenant.name,
        authorityName: null,
        revoked: course.cert.revokedAt !== null || course.record.deletedAt !== null,
      }
    }

    const [skill] = await tx
      .select({
        cert: trainingSkillCertificates,
        assignment: trainingSkillAssignments,
        skillType: trainingSkillTypes,
        authority: trainingSkillAuthorities,
        person: people,
        tenant: tenants,
      })
      .from(trainingSkillCertificates)
      .innerJoin(
        trainingSkillAssignments,
        eq(trainingSkillAssignments.id, trainingSkillCertificates.skillAssignmentId),
      )
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))
      .innerJoin(tenants, eq(tenants.id, trainingSkillCertificates.tenantId))
      .where(eq(trainingSkillCertificates.verifyToken, token))
      .limit(1)
    if (skill) {
      return {
        kind: 'skill' as const,
        personName: `${skill.person.firstName} ${skill.person.lastName}`,
        credentialName: skill.skillType.name,
        credentialCode: skill.skillType.code,
        issuedOn: skill.assignment.grantedOn,
        expiresOn: skill.assignment.expiresOn,
        issuerName: skill.tenant.name,
        authorityName: skill.authority.name,
        // A skill is revoked by soft-deleting its assignment (see
        // training_skill_assignments), so honour deletedAt like the course
        // branch honours the record's — not just the certificate row's revokedAt.
        revoked: skill.cert.revokedAt !== null || skill.assignment.deletedAt !== null,
      }
    }

    return null
  })
}

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await resolveToken(token)

  if (!result) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <Card className="max-w-md">
          <CardContent className="space-y-2 pt-6 text-center">
            <h1 className="text-xl font-semibold text-red-700">Credential not found</h1>
            <p className="text-sm text-slate-600">This verification token is unknown or invalid.</p>
          </CardContent>
        </Card>
      </main>
    )
  }

  // A credential is valid THROUGH its expiry date (`expires_on < CURRENT_DATE`
  // in packages/db views), so compare date-only strings — parsing the yyyy-mm-dd
  // value as a Date would flip to EXPIRED at UTC midnight on the final valid day.
  const todayIso = new Date().toISOString().slice(0, 10)
  const expired = result.expiresOn ? result.expiresOn < todayIso : false

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-3 pt-6 text-center">
          <div
            className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
              result.revoked
                ? 'bg-red-100 text-red-800'
                : expired
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-green-100 text-green-800'
            }`}
          >
            {result.revoked ? 'REVOKED' : expired ? 'EXPIRED' : 'VALID'}
          </div>
          <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            {result.kind === 'skill' ? 'Skill credential' : 'Training certificate'}
          </div>
          <h1 className="text-2xl font-semibold">{result.personName}</h1>
          <p className="text-sm text-slate-600">
            {result.credentialCode ? `${result.credentialCode} · ` : ''}
            {result.credentialName}
          </p>
          <dl className="mx-auto grid grid-cols-2 gap-2 pt-2 text-left text-sm">
            <dt className="text-slate-500">Issued</dt>
            <dd>{result.issuedOn}</dd>
            {result.expiresOn ? (
              <>
                <dt className="text-slate-500">Expires</dt>
                <dd>{result.expiresOn}</dd>
              </>
            ) : null}
            <dt className="text-slate-500">Issuer</dt>
            <dd>{result.issuerName}</dd>
            {result.authorityName ? (
              <>
                <dt className="text-slate-500">Authority</dt>
                <dd>{result.authorityName}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </main>
  )
}
