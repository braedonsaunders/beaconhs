import { FileSignature } from 'lucide-react'
import { and, asc, desc, eq, gte, isNull, lte, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import {
  hazidAssessmentSignatures,
  hazidAssessmentTypes,
  hazidAssessments,
  hazidSignedReports,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { HazidSubNav } from '../../_subnav'
import {
  buildSignedReport,
  deleteSignedReport,
  markSignedReportReady,
} from '../../_actions'
import { SignedReportBuilder } from './_builder'

export const metadata = { title: 'Signed-report bundles' }
export const dynamic = 'force-dynamic'

export default async function SignedReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const dateFrom = typeof sp.from === 'string' ? sp.from : null
  const dateTo = typeof sp.to === 'string' ? sp.to : null
  const siteFilter = typeof sp.site === 'string' ? sp.site : null
  const supervisorFilter = typeof sp.supervisor === 'string' ? sp.supervisor : null

  const ctx = await requireRequestContext()
  const { signedAssessments, sites, supervisors, bundles } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [
      eq(hazidAssessments.locked, true),
      isNull(hazidAssessments.deletedAt),
    ]
    if (dateFrom) filters.push(gte(hazidAssessments.occurredAt, new Date(dateFrom)))
    if (dateTo) filters.push(lte(hazidAssessments.occurredAt, new Date(dateTo + 'T23:59:59')))
    if (siteFilter) filters.push(eq(hazidAssessments.siteOrgUnitId, siteFilter))
    if (supervisorFilter) filters.push(eq(hazidAssessments.supervisorPersonId, supervisorFilter))

    const signedAssessments = await tx
      .select({
        a: hazidAssessments,
        site: orgUnits,
        supervisor: people,
        type: hazidAssessmentTypes,
      })
      .from(hazidAssessments)
      .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
      .leftJoin(people, eq(people.id, hazidAssessments.supervisorPersonId))
      .leftJoin(hazidAssessmentTypes, eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId))
      .where(and(...filters))
      .orderBy(desc(hazidAssessments.occurredAt))
      .limit(200)

    const sites = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
    const supervisors = await tx
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .orderBy(asc(people.lastName))

    const bundles = await tx
      .select()
      .from(hazidSignedReports)
      .orderBy(desc(hazidSignedReports.createdAt))
      .limit(50)

    return { signedAssessments, sites, supervisors, bundles }
  })

  // Count each assessment's signature totals to give a "% signed" hint.
  const sigCounts = await ctx.db(async (tx) => {
    if (signedAssessments.length === 0) return new Map<string, { signed: number; total: number }>()
    const rows = await tx
      .select({
        assessmentId: hazidAssessmentSignatures.assessmentId,
        hasSig: hazidAssessmentSignatures.signatureDataUrl,
      })
      .from(hazidAssessmentSignatures)
    const map = new Map<string, { signed: number; total: number }>()
    for (const r of rows) {
      const cur = map.get(r.assessmentId) ?? { signed: 0, total: 0 }
      cur.total += 1
      if (r.hasSig) cur.signed += 1
      map.set(r.assessmentId, cur)
    }
    return map
  })

  return (
    <ListPageLayout
      header={
        <>
          <HazidSubNav pathname="/hazid/reports/signed" />
          <PageHeader
            title="Signed-report bundles"
            description="Bundle N completed hazard assessments into a single signed-report PDF for distribution."
          />
          <form className="flex flex-wrap items-end gap-2">
            <Field label="From">
              <Input type="date" name="from" defaultValue={dateFrom ?? ''} />
            </Field>
            <Field label="To">
              <Input type="date" name="to" defaultValue={dateTo ?? ''} />
            </Field>
            <Field label="Site">
              <Select name="site" defaultValue={siteFilter ?? ''}>
                <option value="">All</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Supervisor">
              <Select name="supervisor" defaultValue={supervisorFilter ?? ''}>
                <option value="">All</option>
                {supervisors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.lastName}, {p.firstName}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="outline">
              Apply filters
            </Button>
          </form>
        </>
      }
    >
      <div className="space-y-6">
        <Section title={`Eligible assessments (${signedAssessments.length})`} defaultOpen>
          {signedAssessments.length === 0 ? (
            <EmptyState
              icon={<FileSignature size={28} />}
              title="No locked assessments match"
              description="Only locked (signed-off) assessments can be bundled."
            />
          ) : (
            <SignedReportBuilder
              assessments={signedAssessments.map((row) => {
                const sigs = sigCounts.get(row.a.id) ?? { signed: 0, total: 0 }
                return {
                  id: row.a.id,
                  reference: row.a.reference,
                  occurredAt: row.a.occurredAt.toISOString(),
                  typeName: row.type?.name ?? '',
                  siteName: row.site?.name ?? '',
                  supervisorName: row.supervisor ? `${row.supervisor.firstName} ${row.supervisor.lastName}` : '',
                  signedCount: sigs.signed,
                  totalSignatures: sigs.total,
                }
              })}
              buildAction={buildSignedReport}
            />
          )}
        </Section>

        <Section title={`Bundles (${bundles.length})`} defaultOpen>
          {bundles.length === 0 ? (
            <p className="text-sm text-slate-500">No bundles built yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Assessments</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bundles.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium text-slate-900">{b.title}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{b.assessmentIds.length}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          b.status === 'ready'
                            ? 'success'
                            : b.status === 'pending'
                              ? 'secondary'
                              : b.status === 'generating'
                                ? 'warning'
                                : 'destructive'
                        }
                      >
                        {b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {new Date(b.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="flex items-center justify-end gap-2">
                      {b.status === 'pending' ? (
                        <form action={markSignedReportReady}>
                          <input type="hidden" name="id" value={b.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Mark ready
                          </Button>
                        </form>
                      ) : null}
                      <form action={deleteSignedReport}>
                        <input type="hidden" name="id" value={b.id} />
                        <Button type="submit" size="sm" variant="ghost" className="text-red-600">
                          Delete
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </ListPageLayout>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}
