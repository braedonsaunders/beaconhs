import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { FileText, IdCard } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
} from '@beaconhs/ui'
import {
  people,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailGrid } from '@/components/detail-grid'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Training record · ${id.slice(0, 8)}` }
}

export default async function TrainingRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        record: trainingRecords,
        person: people,
        course: trainingCourses,
      })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(eq(trainingRecords.id, id))
      .limit(1)
    if (!row) return null
    const certs = await tx
      .select()
      .from(trainingCertificates)
      .where(eq(trainingCertificates.recordId, id))
    return { ...row, certs }
  })

  if (!data) notFound()
  const { record, person, course, certs } = data

  const today = new Date()
  const exp = record.expiresOn ? new Date(record.expiresOn) : null
  const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
  const status: 'ok' | 'expiring' | 'expired' | 'no_expiry' =
    daysLeft === null ? 'no_expiry' : daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'expiring' : 'ok'

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/training', label: 'Back to training' }}
          title={course.name}
          subtitle={`${person.firstName} ${person.lastName} · completed ${record.completedOn}`}
          badge={
            status === 'expired' ? (
              <Badge variant="destructive">Expired {Math.abs(daysLeft!)}d ago</Badge>
            ) : status === 'expiring' ? (
              <Badge variant="warning">{daysLeft}d left</Badge>
            ) : status === 'ok' ? (
              <Badge variant="success">Valid</Badge>
            ) : (
              <Badge variant="secondary">No expiry</Badge>
            )
          }
          actions={
            <>
              <Link href={`/training/records/${id}/certificate?format=wallet`}>
                <Button variant="outline">
                  <IdCard size={14} /> Wallet card
                </Button>
              </Link>
              <Link href={`/training/records/${id}/certificate?format=cert`}>
                <Button variant="outline">
                  <FileText size={14} /> Certificate PDF
                </Button>
              </Link>
            </>
          }
        />

        <DetailGrid
          rows={[
            {
              label: 'Person',
              value: (
                <Link href={`/people/${person.id}`} className="text-teal-700 hover:underline">
                  {person.firstName} {person.lastName}
                </Link>
              ),
            },
            {
              label: 'Course',
              value: (
                <Link href={`/training/courses/${course.id}`} className="text-teal-700 hover:underline">
                  {course.code} · {course.name}
                </Link>
              ),
            },
            { label: 'Source', value: record.source.replace('_', ' ') },
            { label: 'Completed on', value: record.completedOn },
            { label: 'Expires on', value: record.expiresOn ?? '—' },
            { label: 'Instructor', value: record.instructor ?? '—' },
            { label: 'Grade', value: record.grade != null ? `${record.grade}%` : '—' },
            { label: 'Certificate type', value: record.certificateType ?? '—' },
          ]}
        />

        {record.details ? (
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{record.details}</p>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Issued certificates ({certs.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {certs.length === 0 ? (
              <p className="text-sm text-slate-500">No certificate generated yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {certs.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span>Verify token: <span className="font-mono text-xs">{c.verifyToken}</span></span>
                    {c.revokedAt ? (
                      <Badge variant="destructive">Revoked</Badge>
                    ) : (
                      <Link
                        href={`/verify/${c.verifyToken}` as any}
                        className="text-xs text-teal-700 hover:underline"
                        target="_blank"
                      >
                        Verify page →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
