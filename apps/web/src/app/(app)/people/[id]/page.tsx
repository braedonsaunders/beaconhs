import { notFound } from 'next/navigation'
import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { FileText, Mail, Pencil, Phone } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  crews,
  departments,
  documentAcknowledgments,
  documents,
  incidentInjuries,
  incidentPeople,
  incidents,
  people,
  ppeIssues,
  ppeItems,
  ppeTypes,
  trades,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { PersonEditTab } from './person-edit-tab'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

const TABS = ['transcript', 'compliance', 'incidents', 'ppe', 'edit'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Person · ${id.slice(0, 8)}` }
}

export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'transcript')

  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ person: people, department: departments, trade: trades, crew: crews })
      .from(people)
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .leftJoin(trades, eq(trades.id, people.tradeId))
      .leftJoin(crews, eq(crews.id, people.crewId))
      .where(eq(people.id, id))
      .limit(1)
    if (!row) return null

    const [training, incidentInvolvement, injuryRows, ppeAssigned, ppeIssueLog, ackedDocs] =
      await Promise.all([
        tx
          .select({ record: trainingRecords, course: trainingCourses })
          .from(trainingRecords)
          .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
          .where(eq(trainingRecords.personId, id))
          .orderBy(desc(trainingRecords.completedOn)),
        tx
          .select({ link: incidentPeople, incident: incidents })
          .from(incidentPeople)
          .innerJoin(incidents, eq(incidents.id, incidentPeople.incidentId))
          .where(eq(incidentPeople.personId, id))
          .orderBy(desc(incidents.occurredAt)),
        tx
          .select({ injury: incidentInjuries, incident: incidents })
          .from(incidentInjuries)
          .innerJoin(incidents, eq(incidents.id, incidentInjuries.incidentId))
          .where(eq(incidentInjuries.personId, id))
          .orderBy(desc(incidents.occurredAt)),
        tx
          .select({ item: ppeItems, type: ppeTypes })
          .from(ppeItems)
          .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
          .where(eq(ppeItems.currentHolderPersonId, id)),
        tx
          .select({ issue: ppeIssues, item: ppeItems, type: ppeTypes })
          .from(ppeIssues)
          .innerJoin(ppeItems, eq(ppeItems.id, ppeIssues.itemId))
          .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
          .where(eq(ppeIssues.personId, id))
          .orderBy(desc(ppeIssues.occurredAt)),
        tx
          .select({ ack: documentAcknowledgments, doc: documents })
          .from(documentAcknowledgments)
          .innerJoin(documents, eq(documents.id, documentAcknowledgments.documentId))
          .where(eq(documentAcknowledgments.personId, id))
          .orderBy(desc(documentAcknowledgments.acknowledgedAt)),
      ])

    return { ...row, training, incidentInvolvement, injuryRows, ppeAssigned, ppeIssueLog, ackedDocs }
  })

  if (!data) notFound()
  const {
    person, department, trade, crew,
    training, incidentInvolvement, injuryRows,
    ppeAssigned, ppeIssueLog, ackedDocs,
  } = data

  const today = new Date()
  const trainingWithStatus = training
    .map((t) => {
      const exp = t.record.expiresOn ? new Date(t.record.expiresOn) : null
      const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
      const status: 'ok' | 'expiring' | 'expired' | 'no_expiry' =
        daysLeft === null ? 'no_expiry' : daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'expiring' : 'ok'
      return { ...t, daysLeft, status }
    })
    .sort((a, b) => {
      const rank = { expired: 0, expiring: 1, ok: 2, no_expiry: 3 } as const
      return rank[a.status] - rank[b.status]
    })

  const expiredCount = trainingWithStatus.filter((t) => t.status === 'expired').length
  const expiringCount = trainingWithStatus.filter((t) => t.status === 'expiring').length

  const incidentMap = new Map<string, { incident: typeof incidents.$inferSelect; injured: boolean }>()
  for (const r of incidentInvolvement) incidentMap.set(r.incident.id, { incident: r.incident, injured: false })
  for (const r of injuryRows) {
    const existing = incidentMap.get(r.incident.id)
    if (existing) existing.injured = true
    else incidentMap.set(r.incident.id, { incident: r.incident, injured: true })
  }
  const allIncidents = Array.from(incidentMap.values()).sort(
    (a, b) => new Date(b.incident.occurredAt).getTime() - new Date(a.incident.occurredAt).getTime(),
  )

  const basePath = `/people/${id}`
  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/people', label: 'Back to people' }}
          title={`${person.firstName} ${person.lastName}`}
          subtitle={person.formalName ?? (person.employeeNo ? `Employee ${person.employeeNo}` : undefined)}
          badge={<Badge variant={person.status === 'active' ? 'success' : 'secondary'}>{person.status}</Badge>}
          actions={
            <Link href={`${basePath}?tab=edit`}>
              <Button variant="outline">
                <Pencil size={14} />
                Edit
              </Button>
            </Link>
          }
        />

        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-3">
            <Card>
              <CardContent className="space-y-3 p-5 text-sm">
                <div className="flex flex-col items-center gap-2 pb-3">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-teal-100 text-2xl font-semibold text-teal-800">
                    {person.firstName[0]}
                    {person.lastName[0]}
                  </div>
                  <div className="text-center">
                    <div className="text-base font-semibold">
                      {person.formalName ?? `${person.firstName} ${person.lastName}`}
                    </div>
                    <div className="text-xs text-slate-500">{person.jobTitle ?? '—'}</div>
                    <div className="text-xs text-slate-500">{trade?.name ?? ''}</div>
                  </div>
                </div>
                <SidebarRow label="Employee #">{person.employeeNo ?? '—'}</SidebarRow>
                <SidebarRow label="Department">{department?.name ?? '—'}</SidebarRow>
                <SidebarRow label="Crew">{crew?.name ?? '—'}</SidebarRow>
                <SidebarRow label="Hire date">{person.hireDate ?? '—'}</SidebarRow>
                {person.email ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail size={14} className="text-slate-400" />
                    <a href={`mailto:${person.email}`} className="text-teal-700 hover:underline">
                      {person.email}
                    </a>
                  </div>
                ) : null}
                {person.phone ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone size={14} className="text-slate-400" />
                    <a href={`tel:${person.phone}`} className="text-teal-700 hover:underline">
                      {person.phone}
                    </a>
                  </div>
                ) : null}
              </CardContent>
            </Card>
            {person.emergencyContactName || person.emergencyContactPhone ? (
              <Card className="border-red-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-red-800">Emergency contact</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 pt-0 text-sm">
                  <div className="font-medium">{person.emergencyContactName ?? '—'}</div>
                  {person.emergencyContactPhone ? (
                    <a href={`tel:${person.emergencyContactPhone}`} className="text-teal-700 hover:underline">
                      {person.emergencyContactPhone}
                    </a>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
            {person.notes ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Notes</CardTitle>
                </CardHeader>
                <CardContent className="whitespace-pre-wrap pt-0 text-sm text-slate-700">
                  {person.notes}
                </CardContent>
              </Card>
            ) : null}
          </aside>

          <div className="space-y-4">
            <TabNav
              basePath={basePath}
              currentParams={sp}
              active={active}
              tabs={[
                { key: 'transcript', label: 'Transcript', count: training.length },
                { key: 'compliance', label: 'Compliance', count: expiredCount + expiringCount },
                { key: 'incidents', label: 'Incidents', count: allIncidents.length },
                { key: 'ppe', label: 'PPE', count: ppeAssigned.length },
                { key: 'edit', label: 'Edit' },
              ]}
            />

            {active === 'transcript' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Training transcript</CardTitle>
                </CardHeader>
                <CardContent>
                  {trainingWithStatus.length === 0 ? (
                    <EmptyState icon={<FileText size={24} />} title="No training records" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Course</TableHead>
                          <TableHead>Completed</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Grade</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {trainingWithStatus.map((row) => (
                          <TableRow key={row.record.id}>
                            <TableCell className="font-medium">
                              <Link href={`/training/records/${row.record.id}`} className="hover:underline">
                                {row.course.name}
                              </Link>
                            </TableCell>
                            <TableCell>{row.record.completedOn}</TableCell>
                            <TableCell>{row.record.expiresOn ?? '—'}</TableCell>
                            <TableCell>
                              {row.status === 'expired' ? (
                                <Badge variant="destructive">Expired {Math.abs(row.daysLeft!)}d ago</Badge>
                              ) : row.status === 'expiring' ? (
                                <Badge variant="warning">{row.daysLeft}d left</Badge>
                              ) : row.status === 'ok' ? (
                                <Badge variant="success">Valid</Badge>
                              ) : (
                                <Badge variant="secondary">No expiry</Badge>
                              )}
                            </TableCell>
                            <TableCell>{row.record.grade != null ? `${row.record.grade}%` : '—'}</TableCell>
                            <TableCell>
                              <Link href={`/training/records/${row.record.id}`} className="text-xs text-teal-700 hover:underline">
                                View →
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {active === 'compliance' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Compliance summary</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                    <Stat label="Valid certifications" value={trainingWithStatus.filter((t) => t.status === 'ok').length} tone="success" />
                    <Stat label="Expiring within 30 days" value={expiringCount} tone="warning" />
                    <Stat label="Expired" value={expiredCount} tone="destructive" />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Acknowledged documents ({ackedDocs.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ackedDocs.length === 0 ? (
                      <p className="text-sm text-slate-500">No documents acknowledged.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100 text-sm">
                        {ackedDocs.map((row) => (
                          <li key={row.ack.id} className="flex items-center justify-between py-2">
                            <Link href={`/documents/${row.doc.id}`} className="font-medium hover:underline">
                              {row.doc.title}
                            </Link>
                            <span className="text-xs text-slate-500">
                              {new Date(row.ack.acknowledgedAt).toLocaleDateString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {active === 'incidents' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Incidents involving this person</CardTitle>
                </CardHeader>
                <CardContent>
                  {allIncidents.length === 0 ? (
                    <EmptyState icon={<FileText size={24} />} title="Not involved in any incidents" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ref</TableHead>
                          <TableHead>Occurred</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allIncidents.map(({ incident, injured }) => (
                          <TableRow key={incident.id}>
                            <TableCell className="font-mono text-xs">
                              <Link href={`/incidents/${incident.id}`} className="hover:underline">
                                {incident.reference}
                              </Link>
                            </TableCell>
                            <TableCell>{new Date(incident.occurredAt).toLocaleDateString()}</TableCell>
                            <TableCell>{incident.title}</TableCell>
                            <TableCell>
                              <Badge variant={injured ? 'destructive' : 'secondary'}>
                                {injured ? 'Injured' : 'Involved'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-slate-600">{incident.status.replace(/_/g, ' ')}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {active === 'ppe' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Currently assigned ({ppeAssigned.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ppeAssigned.length === 0 ? (
                      <p className="text-sm text-slate-500">No PPE currently assigned.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Serial #</TableHead>
                            <TableHead>Size</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ppeAssigned.map((row) => (
                            <TableRow key={row.item.id}>
                              <TableCell className="font-medium">{row.type.name}</TableCell>
                              <TableCell>{row.item.serialNumber ?? '—'}</TableCell>
                              <TableCell>{row.item.size ?? '—'}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{row.item.status.replace('_', ' ')}</Badge>
                              </TableCell>
                              <TableCell>
                                <Link href={`/ppe/${row.item.id}`} className="text-xs text-teal-700 hover:underline">
                                  View →
                                </Link>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Issue history ({ppeIssueLog.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ppeIssueLog.length === 0 ? (
                      <p className="text-sm text-slate-500">No issue history.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100 text-sm">
                        {ppeIssueLog.map((row) => (
                          <li key={row.issue.id} className="flex items-center justify-between py-2">
                            <div>
                              <span className="font-medium">{row.type.name}</span>{' '}
                              <span className="text-slate-500">{row.item.serialNumber ?? ''}</span>
                              <div className="text-xs text-slate-500">{row.issue.action}</div>
                            </div>
                            <span className="text-xs text-slate-500">
                              {new Date(row.issue.occurredAt).toLocaleDateString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {active === 'edit' ? <PersonEditTab personId={id} /> : null}
          </div>
        </div>
      </div>
    </PageContainer>
  )
}

function SidebarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warning' | 'destructive' }) {
  const colour = tone === 'success' ? 'text-emerald-700' : tone === 'warning' ? 'text-amber-700' : 'text-red-700'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${colour}`}>{value}</div>
    </div>
  )
}
