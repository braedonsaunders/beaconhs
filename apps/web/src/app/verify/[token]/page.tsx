// Public certificate-verification page. Resolved purely from a token; no auth.

import { eq, sql } from 'drizzle-orm'
import { Card, CardContent } from '@beaconhs/ui'
import { db } from '@beaconhs/db'
import {
  people,
  tenants,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'

export const dynamic = 'force-dynamic'

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [row] = await tx
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
    return row
  })

  if (!result) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <Card className="max-w-md">
          <CardContent className="space-y-2 pt-6 text-center">
            <h1 className="text-xl font-semibold text-red-700">Certificate not found</h1>
            <p className="text-sm text-slate-600">This verification token is unknown or invalid.</p>
          </CardContent>
        </Card>
      </main>
    )
  }

  const expired = result.record.expiresOn && new Date(result.record.expiresOn) < new Date()
  const revoked = result.cert.revokedAt !== null

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-3 pt-6 text-center">
          <div
            className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
              revoked
                ? 'bg-red-100 text-red-800'
                : expired
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-green-100 text-green-800'
            }`}
          >
            {revoked ? 'REVOKED' : expired ? 'EXPIRED' : 'VALID'}
          </div>
          <h1 className="text-2xl font-semibold">
            {result.person.firstName} {result.person.lastName}
          </h1>
          <p className="text-sm text-slate-600">{result.course.name}</p>
          <dl className="mx-auto grid grid-cols-2 gap-2 pt-2 text-left text-sm">
            <dt className="text-slate-500">Issued</dt>
            <dd>{result.record.completedOn}</dd>
            {result.record.expiresOn ? (
              <>
                <dt className="text-slate-500">Expires</dt>
                <dd>{result.record.expiresOn}</dd>
              </>
            ) : null}
            <dt className="text-slate-500">Issuer</dt>
            <dd>{result.tenant.name}</dd>
          </dl>
        </CardContent>
      </Card>
    </main>
  )
}
