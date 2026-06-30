import { notFound } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import {
  Award,
  BadgeCheck,
  CheckSquare,
  FileText,
  HardHat,
  IdCard,
  Mail,
  Paperclip,
  PenLine,
  Phone,
  ShieldCheck,
  Square,
  Trash2,
  Users,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  attachments,
  crews,
  departments,
  documentAcknowledgments,
  documents,
  formResponses,
  formTemplates,
  incidentInjuries,
  incidentPeople,
  incidents,
  jobTitleTaskAcknowledgments,
  jobTitleTasks,
  people,
  personFiles,
  personGroupMemberships,
  personGroups,
  personTitleAssignments,
  personTitles,
  ppeIssues,
  ppeItems,
  ppeTypes,
  trades,
  trainingCourses,
  trainingRecords,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { LiveField, LivePersonSelect, LiveSelect } from '@/components/live-field'
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section'
import { assertCanManageModule, canManageModule } from '@/lib/module-admin/guard'
import { getPersonSyncOrigin, SYNC_OWNED_PERSON_FIELDS } from '@/lib/people-sync'
import { PageContainer } from '@/components/page-layout'
import { togglePersonInGroup } from '../_actions/groups'
import {
  acknowledgeTitleTask,
  assignTitleToPerson,
  revokeTitleTaskAck,
  setPrimaryTitle,
  unassignTitleFromPerson,
} from '../_actions/titles'
import { clearPersonSignature, deletePersonFile } from '../_actions/files'
import { PersonFilesDrawers } from './_files-drawers'

export const dynamic = 'force-dynamic'

const TABS = [
  'overview',
  'groups',
  'title',
  'compliance',
  'training',
  'skills',
  'ppe',
  'documents',
  'incidents',
  'forms',
  'activity',
] as const
type Tab = (typeof TABS)[number]

// App-owned fields stay editable even while a person is synced. Everything in
// SYNC_OWNED_PERSON_FIELDS is locked at the source. dateOfBirth and
// terminationDate are manual/app-owned (no sync writes them).
const APP_OWNED_FIELDS = new Set([
  'formalName',
  'externalEmployeeId',
  'crewId',
  'managerPersonId',
  'emergencyContactName',
  'emergencyContactPhone',
  'notes',
  'dateOfBirth',
  'terminationDate',
])
const SYNC_OWNED_FIELDS = new Set<string>(SYNC_OWNED_PERSON_FIELDS)
const EDITABLE_FIELDS = new Set<string>([...APP_OWNED_FIELDS, ...SYNC_OWNED_FIELDS])
const PERSON_STATUSES = ['active', 'inactive', 'terminated'] as const

/**
 * Auto-save a single person field. Mirrors the incidents `updateTextField`
 * recipe, but layers the directory's sync-lock rule on top: while the person is
 * actively synced, the source system owns the identity fields and any write to
 * one is rejected server-side (the disabled inputs are only the UI half of this
 * guard). App-owned fields stay editable regardless.
 */
async function updatePersonField(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = formData.get('value')
  const rawValue = typeof raw === 'string' ? raw.trim() : ''
  if (!id || !field) throw new Error('Missing id/field')
  if (!EDITABLE_FIELDS.has(field)) throw new Error('Field not allowed')

  const { before, synced } = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(people).where(eq(people.id, id)).limit(1)
    const origin = row ? await getPersonSyncOrigin(tx, id) : null
    return { before: row, synced: origin != null }
  })
  if (!before) throw new Error('Person not found')

  // Server-side half of the sync lock: a synced person's identity fields are
  // owned by the source — reject the write outright.
  if (synced && SYNC_OWNED_FIELDS.has(field)) {
    throw new Error('Field is managed by an external sync and is read-only')
  }

  // A person can never be their own manager.
  if (field === 'managerPersonId' && rawValue === id) {
    return
  }

  // Required identity fields must not be blanked (only reachable when not synced).
  if ((field === 'firstName' || field === 'lastName') && !rawValue) {
    throw new Error('First and last name are required')
  }

  let value: string | null = rawValue || null
  if (field === 'firstName' || field === 'lastName') {
    value = rawValue
  } else if (field === 'status') {
    if (!(PERSON_STATUSES as readonly string[]).includes(rawValue)) {
      throw new Error('Invalid status')
    }
    value = rawValue
  }

  await ctx.db((tx) =>
    tx
      .update(people)
      .set({ [field]: value } as Partial<typeof people.$inferInsert>)
      .where(eq(people.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'person',
    entityId: id,
    action: 'update',
    summary: `Person ${field} updated`,
    before: { [field]: (before as Record<string, unknown>)[field] },
    after: { [field]: value },
  })
  revalidatePath(`/people/${id}`)
}

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
  const active: Tab = pickActiveTab(sp, TABS, 'overview')

  const ctx = await requireRequestContext()
  const canEdit = canManageModule(ctx, 'people')
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

    const [
      training,
      skills,
      incidentInvolvement,
      injuryRows,
      ppeAssigned,
      ppeIssueLog,
      ackedDocs,
      submittedForms,
      personGroupRows,
      allGroups,
      personTitleRows,
      allTitles,
      fileRows,
      signatureAtt,
      managerRow,
      deptOptions,
      tradeOptions,
      crewOptions,
      managerOptions,
      syncOrigin,
    ] = await Promise.all([
      tx
        .select({ record: trainingRecords, course: trainingCourses })
        .from(trainingRecords)
        .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
        .where(and(eq(trainingRecords.personId, id), isNull(trainingRecords.deletedAt)))
        .orderBy(desc(trainingRecords.completedOn)),
      tx
        .select({
          assignment: trainingSkillAssignments,
          skillType: trainingSkillTypes,
          authority: trainingSkillAuthorities,
        })
        .from(trainingSkillAssignments)
        .innerJoin(
          trainingSkillTypes,
          eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
        )
        .leftJoin(
          trainingSkillAuthorities,
          eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
        )
        .where(
          and(
            eq(trainingSkillAssignments.personId, id),
            isNull(trainingSkillAssignments.deletedAt),
          ),
        )
        .orderBy(desc(trainingSkillAssignments.grantedOn)),
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
        // Currently-issued PPE only — items the person returned (or had before leaving) are not "current".
        .where(and(eq(ppeItems.currentHolderPersonId, id), eq(ppeItems.status, 'issued'))),
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
      tx
        .select({ response: formResponses, template: formTemplates })
        .from(formResponses)
        .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
        .where(eq(formResponses.subjectPersonId, id))
        .orderBy(desc(formResponses.submittedAt)),
      // Groups this person belongs to
      tx
        .select({ membership: personGroupMemberships, group: personGroups })
        .from(personGroupMemberships)
        .innerJoin(personGroups, eq(personGroups.id, personGroupMemberships.groupId))
        .where(eq(personGroupMemberships.personId, id))
        .orderBy(asc(personGroups.name)),
      tx.select().from(personGroups).orderBy(asc(personGroups.name)),
      // Titles this person holds
      tx
        .select({ assignment: personTitleAssignments, title: personTitles })
        .from(personTitleAssignments)
        .innerJoin(personTitles, eq(personTitles.id, personTitleAssignments.titleId))
        .where(eq(personTitleAssignments.personId, id))
        .orderBy(desc(personTitleAssignments.isPrimary), asc(personTitles.name)),
      tx.select().from(personTitles).orderBy(asc(personTitles.name)),
      // Personal files (resumes, certs, ID copies) joined to their underlying
      // attachment row so we can render a download link inline.
      tx
        .select({ file: personFiles, attachment: attachments })
        .from(personFiles)
        .leftJoin(attachments, eq(attachments.id, personFiles.attachmentId))
        .where(eq(personFiles.personId, id))
        .orderBy(desc(personFiles.uploadedAt)),
      // Signature image attachment (single row) — used both on this page and
      // inline by inspections / lift plans / form sign-offs when this person
      // signs.
      row.person.signatureAttachmentId
        ? tx
            .select()
            .from(attachments)
            .where(eq(attachments.id, row.person.signatureAttachmentId))
            .limit(1)
            .then((rs) => rs[0] ?? null)
        : Promise.resolve(null),
      // Manager for the side-panel "reports to" row + a quick org-chart link.
      row.person.managerPersonId
        ? tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
              jobTitle: people.jobTitle,
            })
            .from(people)
            .where(eq(people.id, row.person.managerPersonId))
            .limit(1)
            .then((rs) => rs[0] ?? null)
        : Promise.resolve(null),
      // Lookup lists for the Overview tab's Live* selects.
      tx
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .orderBy(asc(departments.name)),
      tx.select({ id: trades.id, name: trades.name }).from(trades).orderBy(asc(trades.name)),
      tx.select({ id: crews.id, name: crews.name }).from(crews).orderBy(asc(crews.name)),
      // Manager picker — active people excluding self.
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
        })
        .from(people)
        .where(and(ne(people.id, id), eq(people.status, 'active')))
        .orderBy(asc(people.lastName), asc(people.firstName)),
      getPersonSyncOrigin(tx, id),
    ])

    // Second pass for title tasks now that we know the titles
    const heldTitleIds = personTitleRows.map((r) => r.title.id)
    const tasksForHeldTitles =
      heldTitleIds.length > 0
        ? await tx
            .select()
            .from(jobTitleTasks)
            .where(inArray(jobTitleTasks.titleId, heldTitleIds))
            .orderBy(asc(jobTitleTasks.entityOrder))
        : []
    const taskIds = tasksForHeldTitles.map((t) => t.id)
    const acksForPerson =
      taskIds.length > 0
        ? await tx
            .select()
            .from(jobTitleTaskAcknowledgments)
            .where(inArray(jobTitleTaskAcknowledgments.taskId, taskIds))
        : []
    const acksForThisPerson = acksForPerson.filter((a) => a.personId === id)

    return {
      ...row,
      training,
      skills,
      incidentInvolvement,
      injuryRows,
      ppeAssigned,
      ppeIssueLog,
      ackedDocs,
      submittedForms,
      personGroupRows,
      allGroups,
      personTitleRows,
      allTitles,
      titleTasks: tasksForHeldTitles,
      titleTaskAcks: acksForThisPerson,
      fileRows,
      signatureAtt,
      managerRow,
      deptOptions,
      tradeOptions,
      crewOptions,
      managerOptions,
      syncOrigin,
    }
  })

  if (!data) notFound()
  const {
    person,
    department,
    trade,
    crew,
    training,
    skills,
    incidentInvolvement,
    injuryRows,
    ppeAssigned,
    ppeIssueLog,
    ackedDocs,
    submittedForms,
    personGroupRows,
    allGroups,
    personTitleRows,
    allTitles,
    titleTasks,
    titleTaskAcks,
    fileRows,
    signatureAtt,
    managerRow,
    deptOptions,
    tradeOptions,
    crewOptions,
    managerOptions,
    syncOrigin,
  } = data
  const signatureUrl = signatureAtt ? publicUrl(signatureAtt.r2Key) : null
  const openDrawer = typeof sp.drawer === 'string' ? sp.drawer : null
  const basePathForDrawer = `/people/${id}${active === 'overview' ? '' : `?tab=${active}`}`
  const synced = syncOrigin != null
  // A field's input is read-only when the viewer lacks edit permission, OR the
  // person is synced and this is a sync-owned field.
  const fieldDisabled = (field: string) =>
    !canEdit || (synced && SYNC_OWNED_FIELDS.has(field))
  const ackByTaskId = new Map(titleTaskAcks.map((a) => [a.taskId, a]))

  const today = new Date()
  const trainingWithStatus = training
    .map((t) => {
      const exp = t.record.expiresOn ? new Date(t.record.expiresOn) : null
      const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
      const status: 'ok' | 'expiring' | 'expired' | 'no_expiry' =
        daysLeft === null
          ? 'no_expiry'
          : daysLeft < 0
            ? 'expired'
            : daysLeft <= 30
              ? 'expiring'
              : 'ok'
      return { ...t, daysLeft, status }
    })
    .sort((a, b) => {
      const rank = { expired: 0, expiring: 1, ok: 2, no_expiry: 3 } as const
      return rank[a.status] - rank[b.status]
    })

  const skillsWithStatus = skills
    .map((s) => {
      const exp = s.assignment.expiresOn ? new Date(s.assignment.expiresOn) : null
      const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
      const status: 'ok' | 'expiring' | 'expired' | 'no_expiry' =
        daysLeft === null
          ? 'no_expiry'
          : daysLeft < 0
            ? 'expired'
            : daysLeft <= 30
              ? 'expiring'
              : 'ok'
      return { ...s, daysLeft, status }
    })
    .sort((a, b) => {
      const rank = { expired: 0, expiring: 1, ok: 2, no_expiry: 3 } as const
      return rank[a.status] - rank[b.status]
    })

  const expiredCount = trainingWithStatus.filter((t) => t.status === 'expired').length
  const expiringCount = trainingWithStatus.filter((t) => t.status === 'expiring').length

  const incidentMap = new Map<
    string,
    { incident: typeof incidents.$inferSelect; injured: boolean }
  >()
  for (const r of incidentInvolvement)
    incidentMap.set(r.incident.id, { incident: r.incident, injured: false })
  for (const r of injuryRows) {
    const existing = incidentMap.get(r.incident.id)
    if (existing) existing.injured = true
    else incidentMap.set(r.incident.id, { incident: r.incident, injured: true })
  }
  const allIncidents = Array.from(incidentMap.values()).sort(
    (a, b) => new Date(b.incident.occurredAt).getTime() - new Date(a.incident.occurredAt).getTime(),
  )

  const activity = active === 'activity' ? await recentActivityForEntity(ctx, 'person', id, 50) : []

  const basePath = `/people/${id}`
  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/people', label: 'Back to people' }}
          title={`${person.firstName} ${person.lastName}`}
          subtitle={
            person.formalName ?? (person.employeeNo ? `Employee ${person.employeeNo}` : undefined)
          }
          badge={
            <Badge variant={person.status === 'active' ? 'success' : 'secondary'}>
              {person.status}
            </Badge>
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
                <SidebarRow label="Reports to">
                  {managerRow ? (
                    <Link
                      href={`/people/${managerRow.id}`}
                      className="text-teal-700 hover:underline"
                    >
                      {managerRow.firstName} {managerRow.lastName}
                    </Link>
                  ) : (
                    '—'
                  )}
                </SidebarRow>
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
                    <a
                      href={`tel:${person.emergencyContactPhone}`}
                      className="text-teal-700 hover:underline"
                    >
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
                <CardContent className="pt-0 text-sm whitespace-pre-wrap text-slate-700">
                  {person.notes}
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <PenLine size={14} className="text-slate-500" />
                  Signature
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {signatureUrl ? (
                  <div className="space-y-2">
                    <img
                      src={signatureUrl}
                      alt={`${person.firstName} ${person.lastName} signature`}
                      className="max-h-16 w-full rounded border border-slate-200 bg-white object-contain p-1"
                    />
                    <div className="flex items-center gap-1">
                      <Link href={`${basePath}?drawer=signature-upload`} className="flex-1">
                        <Button variant="outline" size="sm" className="w-full">
                          Replace
                        </Button>
                      </Link>
                      <form action={clearPersonSignature} className="inline">
                        <input type="hidden" name="personId" value={person.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 size={12} />
                        </Button>
                      </form>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-xs text-slate-500">
                    <p>No signature on file.</p>
                    <Link href={`${basePath}?drawer=signature-upload`} className="block">
                      <Button variant="outline" size="sm" className="w-full">
                        Upload signature
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-4">
            <TabNav
              basePath={basePath}
              currentParams={sp}
              active={active}
              variant="pills"
              tabs={[
                { key: 'overview', label: 'Overview' },
                {
                  key: 'groups',
                  label: 'Groups',
                  count: personGroupRows.length,
                },
                {
                  key: 'title',
                  label: 'Titles',
                  count: personTitleRows.length,
                },
                { key: 'compliance', label: 'Compliance' },
                {
                  key: 'training',
                  label: 'Training',
                  count: training.length,
                },
                { key: 'skills', label: 'Skills', count: skills.length },
                { key: 'ppe', label: 'PPE', count: ppeAssigned.length },
                {
                  key: 'documents',
                  label: 'Documents & files',
                  count: fileRows.length + ackedDocs.length,
                },
                {
                  key: 'incidents',
                  label: 'Incidents',
                  count: allIncidents.length,
                },
                {
                  key: 'forms',
                  label: 'Apps',
                  count: submittedForms.length,
                },
                { key: 'activity', label: 'Activity' },
              ]}
            />

            {active === 'overview' ? (
              <div className="space-y-4">
                {synced ? (
                  <Alert variant="info">
                    <AlertTitle>Synced from {syncOrigin!.connectionName}</AlertTitle>
                    <AlertDescription>
                      Identity fields (name, job title, employee #, contact, department, trade,
                      status, hire date) are kept in sync from {syncOrigin!.sourceSystem} and are
                      read-only here — edit them at the source. App-only fields stay editable.
                    </AlertDescription>
                  </Alert>
                ) : null}
                {!canEdit ? (
                  <Alert variant="info">
                    <AlertTitle>Read-only</AlertTitle>
                    <AlertDescription>
                      You do not have permission to edit this person.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <Section title="Personal" subtitle="Identification and contact info">
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <LiveField
                      id={person.id}
                      field="firstName"
                      label="First name"
                      initialValue={person.firstName}
                      disabled={fieldDisabled('firstName')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="lastName"
                      label="Last name"
                      initialValue={person.lastName}
                      disabled={fieldDisabled('lastName')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="formalName"
                      label="Formal name"
                      initialValue={person.formalName}
                      disabled={fieldDisabled('formalName')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="jobTitle"
                      label="Job title"
                      initialValue={person.jobTitle}
                      disabled={fieldDisabled('jobTitle')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="dateOfBirth"
                      label="Date of birth"
                      type="date"
                      initialValue={person.dateOfBirth}
                      disabled={fieldDisabled('dateOfBirth')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="employeeNo"
                      label="Employee #"
                      initialValue={person.employeeNo}
                      disabled={fieldDisabled('employeeNo')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="email"
                      label="Email"
                      initialValue={person.email}
                      disabled={fieldDisabled('email')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="phone"
                      label="Phone"
                      initialValue={person.phone}
                      disabled={fieldDisabled('phone')}
                      updateAction={updatePersonField}
                    />
                  </div>
                </Section>

                <Section title="Employment" subtitle="Trade, crew, department, and dates">
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <LiveSelect
                      id={person.id}
                      field="status"
                      label="Status"
                      initialValue={person.status}
                      allowEmpty={false}
                      options={[
                        { value: 'active', label: 'Active' },
                        { value: 'inactive', label: 'Inactive' },
                        { value: 'terminated', label: 'Terminated' },
                      ]}
                      disabled={fieldDisabled('status')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="hireDate"
                      label="Hire date"
                      type="date"
                      initialValue={person.hireDate}
                      disabled={fieldDisabled('hireDate')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="terminationDate"
                      label="Termination date"
                      type="date"
                      initialValue={person.terminationDate}
                      disabled={fieldDisabled('terminationDate')}
                      updateAction={updatePersonField}
                    />
                    <LiveSelect
                      id={person.id}
                      field="departmentId"
                      label="Department"
                      initialValue={person.departmentId}
                      options={deptOptions.map((d) => ({ value: d.id, label: d.name }))}
                      disabled={fieldDisabled('departmentId')}
                      updateAction={updatePersonField}
                    />
                    <LiveSelect
                      id={person.id}
                      field="tradeId"
                      label="Trade"
                      initialValue={person.tradeId}
                      options={tradeOptions.map((t) => ({ value: t.id, label: t.name }))}
                      disabled={fieldDisabled('tradeId')}
                      updateAction={updatePersonField}
                    />
                    <LiveSelect
                      id={person.id}
                      field="crewId"
                      label="Crew"
                      initialValue={person.crewId}
                      options={crewOptions.map((c) => ({ value: c.id, label: c.name }))}
                      disabled={fieldDisabled('crewId')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="externalEmployeeId"
                      label="External employee ID"
                      placeholder="e.g. payroll / NetSuite id"
                      initialValue={person.externalEmployeeId}
                      disabled={fieldDisabled('externalEmployeeId')}
                      updateAction={updatePersonField}
                    />
                    <LivePersonSelect
                      id={person.id}
                      field="managerPersonId"
                      label="Reports to"
                      initialValue={person.managerPersonId}
                      options={managerOptions.map((m) => ({
                        value: m.id,
                        label: `${m.lastName}, ${m.firstName}`,
                        hint: m.employeeNo ?? undefined,
                      }))}
                      sheetTitle="Select manager"
                      placeholder="Search people…"
                      disabled={fieldDisabled('managerPersonId')}
                      updateAction={updatePersonField}
                    />
                  </div>
                </Section>

                <Section title="Emergency contact" subtitle="Who to call in an emergency">
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <LiveField
                      id={person.id}
                      field="emergencyContactName"
                      label="Contact name"
                      initialValue={person.emergencyContactName}
                      disabled={fieldDisabled('emergencyContactName')}
                      updateAction={updatePersonField}
                    />
                    <LiveField
                      id={person.id}
                      field="emergencyContactPhone"
                      label="Contact phone"
                      initialValue={person.emergencyContactPhone}
                      disabled={fieldDisabled('emergencyContactPhone')}
                      updateAction={updatePersonField}
                    />
                  </div>
                </Section>

                <Section title="Notes" subtitle="Internal notes about this person">
                  <LiveField
                    id={person.id}
                    field="notes"
                    label="Notes"
                    multiline
                    rows={4}
                    initialValue={person.notes}
                    disabled={fieldDisabled('notes')}
                    updateAction={updatePersonField}
                  />
                </Section>

                <CustomFieldsSection
                  ctx={ctx}
                  entityKind="person"
                  recordId={person.id}
                  subtypeId={null}
                  metadata={person.metadata}
                  locked={!canEdit}
                />
              </div>
            ) : null}

            {active === 'groups' ? (
              <GroupsTab personId={person.id} memberships={personGroupRows} allGroups={allGroups} />
            ) : null}

            {active === 'title' ? (
              <TitleTab
                personId={person.id}
                titlesHeld={personTitleRows}
                allTitles={allTitles}
                titleTasks={titleTasks}
                ackByTaskId={ackByTaskId}
              />
            ) : null}

            {active === 'compliance' ? (
              <ComplianceTab
                trainingTotal={trainingWithStatus.length}
                trainingValid={trainingWithStatus.filter((t) => t.status === 'ok').length}
                trainingExpiring={expiringCount}
                trainingExpired={expiredCount}
                documentsAcked={ackedDocs.length}
                ppeCount={ppeAssigned.length}
                titleTaskTotal={titleTasks.length}
                titleTaskAckedCount={titleTaskAcks.length}
                incidentsCount={allIncidents.length}
              />
            ) : null}

            {active === 'training' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Training matrix</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {trainingWithStatus.length === 0 ? (
                      <EmptyState
                        icon={<FileText size={24} />}
                        title="No training records"
                        description="Records appear here as the person completes courses or uploads external certificates."
                        action={
                          <Link href={`/training/records?personId=${id}` as any}>
                            <Button variant="outline" size="sm">
                              View training module →
                            </Button>
                          </Link>
                        }
                      />
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
                                <Link
                                  href={`/training/records/${row.record.id}`}
                                  className="hover:underline"
                                >
                                  {row.course.name}
                                </Link>
                                <div className="text-xs text-slate-500">{row.course.code}</div>
                              </TableCell>
                              <TableCell>{row.record.completedOn}</TableCell>
                              <TableCell>{row.record.expiresOn ?? '—'}</TableCell>
                              <TableCell>
                                {row.status === 'expired' ? (
                                  <Badge variant="destructive">
                                    Expired {Math.abs(row.daysLeft!)}d ago
                                  </Badge>
                                ) : row.status === 'expiring' ? (
                                  <Badge variant="warning">{row.daysLeft}d left</Badge>
                                ) : row.status === 'ok' ? (
                                  <Badge variant="success">Valid</Badge>
                                ) : (
                                  <Badge variant="secondary">No expiry</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {row.record.grade != null ? `${row.record.grade}%` : '—'}
                              </TableCell>
                              <TableCell>
                                <Link
                                  href={`/training/records/${row.record.id}`}
                                  className="text-xs text-teal-700 hover:underline"
                                >
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
                    <CardTitle>Compliance summary</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                    <Stat
                      label="Valid certifications"
                      value={trainingWithStatus.filter((t) => t.status === 'ok').length}
                      tone="success"
                    />
                    <Stat label="Expiring within 30 days" value={expiringCount} tone="warning" />
                    <Stat label="Expired" value={expiredCount} tone="destructive" />
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {active === 'skills' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Skill assignments</CardTitle>
                </CardHeader>
                <CardContent>
                  {skillsWithStatus.length === 0 ? (
                    <EmptyState
                      icon={<Award size={24} />}
                      title="No skill assignments"
                      description="External skill credentials (e.g. trade certifications, ticketed competencies) appear here."
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Skill</TableHead>
                          <TableHead>Authority</TableHead>
                          <TableHead>Granted</TableHead>
                          <TableHead>Expires</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {skillsWithStatus.map((row) => (
                          <TableRow key={row.assignment.id}>
                            <TableCell className="font-medium">
                              {row.skillType.name}
                              {row.skillType.code ? (
                                <div className="font-mono text-xs text-slate-500">
                                  {row.skillType.code}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-slate-600">
                              {row.authority?.name ?? '—'}
                            </TableCell>
                            <TableCell>{row.assignment.grantedOn}</TableCell>
                            <TableCell>{row.assignment.expiresOn ?? '—'}</TableCell>
                            <TableCell>
                              {row.status === 'expired' ? (
                                <Badge variant="destructive">
                                  Expired {Math.abs(row.daysLeft!)}d ago
                                </Badge>
                              ) : row.status === 'expiring' ? (
                                <Badge variant="warning">{row.daysLeft}d left</Badge>
                              ) : row.status === 'ok' ? (
                                <Badge variant="success">Valid</Badge>
                              ) : (
                                <Badge variant="secondary">No expiry</Badge>
                              )}
                            </TableCell>
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
                                <Badge variant="secondary">
                                  {row.item.status.replace('_', ' ')}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Link
                                  href={`/ppe/${row.item.id}`}
                                  className="text-xs text-teal-700 hover:underline"
                                >
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
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>When</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Serial #</TableHead>
                            <TableHead>Note</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ppeIssueLog.map((row) => (
                            <TableRow key={row.issue.id}>
                              <TableCell>
                                {new Date(row.issue.occurredAt).toLocaleDateString()}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">
                                  {row.issue.action.replace('_', ' ')}
                                </Badge>
                              </TableCell>
                              <TableCell>{row.type.name}</TableCell>
                              <TableCell className="font-mono text-xs">
                                {row.item.serialNumber ?? '—'}
                              </TableCell>
                              <TableCell className="text-xs text-slate-600">
                                {row.issue.note ?? '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {active === 'documents' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-base">
                      <span className="flex items-center gap-2">
                        <Paperclip size={16} />
                        Personal files ({fileRows.length})
                      </span>
                      <Link href={`${basePath}?tab=documents&drawer=upload-person-file`}>
                        <Button size="sm">Upload file</Button>
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {fileRows.length === 0 ? (
                      <EmptyState
                        icon={<Paperclip size={24} />}
                        title="No files uploaded"
                        description="Use the upload button to attach resumes, certifications, ID copies, and other personal documents."
                      />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Label</TableHead>
                            <TableHead>Kind</TableHead>
                            <TableHead>Filename</TableHead>
                            <TableHead>Uploaded</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {fileRows.map(({ file, attachment }) => (
                            <TableRow key={file.id}>
                              <TableCell className="font-medium">{file.label}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{file.kind.replace('_', ' ')}</Badge>
                              </TableCell>
                              <TableCell className="text-xs text-slate-600">
                                {attachment ? (
                                  <a
                                    href={publicUrl(attachment.r2Key)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-teal-700 hover:underline"
                                  >
                                    {attachment.filename}
                                  </a>
                                ) : (
                                  <span className="text-slate-400">file missing</span>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-slate-600">
                                {new Date(file.uploadedAt).toLocaleDateString()}
                              </TableCell>
                              <TableCell>
                                <form action={deletePersonFile} className="inline">
                                  <input type="hidden" name="id" value={file.id} />
                                  <input type="hidden" name="personId" value={person.id} />
                                  <Button
                                    type="submit"
                                    size="sm"
                                    variant="ghost"
                                    className="text-red-500 hover:text-red-700"
                                    title="Delete file"
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </form>
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
                    <CardTitle>Documents acknowledged ({ackedDocs.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ackedDocs.length === 0 ? (
                      <EmptyState
                        icon={<ShieldCheck size={24} />}
                        title="No documents acknowledged"
                        description="Acknowledgements appear here once the person signs off on policies, SDS, or procedures."
                        action={
                          <Link href={`/documents`}>
                            <Button variant="outline" size="sm">
                              Browse documents →
                            </Button>
                          </Link>
                        }
                      />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Document</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Acknowledged at</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ackedDocs.map((row) => (
                            <TableRow key={row.ack.id}>
                              <TableCell className="font-medium">
                                <Link
                                  href={`/documents/${row.doc.id}`}
                                  className="hover:underline"
                                >
                                  {row.doc.title}
                                </Link>
                              </TableCell>
                              <TableCell className="text-slate-600">
                                {row.doc.category ?? '—'}
                              </TableCell>
                              <TableCell>
                                {new Date(row.ack.acknowledgedAt).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Link
                                  href={`/documents/${row.doc.id}`}
                                  className="text-xs text-teal-700 hover:underline"
                                >
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
              </div>
            ) : null}

            {active === 'incidents' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Incidents involving this person</CardTitle>
                </CardHeader>
                <CardContent>
                  {allIncidents.length === 0 ? (
                    <EmptyState
                      icon={<HardHat size={24} />}
                      title="Not involved in any incidents"
                    />
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
                            <TableCell>
                              {new Date(incident.occurredAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>{incident.title}</TableCell>
                            <TableCell>
                              <Badge variant={injured ? 'destructive' : 'secondary'}>
                                {injured ? 'Injured' : 'Involved'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-slate-600">
                              {incident.status.replace(/_/g, ' ')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {active === 'forms' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Apps about this person ({submittedForms.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {submittedForms.length === 0 ? (
                    <EmptyState
                      icon={<FileText size={24} />}
                      title="No apps about this person"
                      description="JSHAs, incident investigations, evaluations, and other app submissions where this person is the subject appear here."
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Form</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Submitted</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {submittedForms.map((row) => (
                          <TableRow key={row.response.id}>
                            <TableCell className="font-medium">{row.template.name}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  row.response.status === 'closed' ||
                                  row.response.status === 'submitted'
                                    ? 'success'
                                    : 'warning'
                                }
                              >
                                {row.response.status.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {row.response.submittedAt
                                ? new Date(row.response.submittedAt).toLocaleDateString()
                                : '—'}
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/apps/responses/${row.response.id}`}
                                className="text-xs text-teal-700 hover:underline"
                              >
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

            {active === 'activity' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityFeed entries={activity} />
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
      <PersonFilesDrawers
        personId={person.id}
        openDrawer={
          openDrawer === 'upload-person-file' || openDrawer === 'signature-upload'
            ? openDrawer
            : null
        }
        closeHref={basePathForDrawer}
      />
    </PageContainer>
  )
}

function SidebarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-xs tracking-wide text-slate-500 uppercase">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'success' | 'warning' | 'destructive'
}) {
  const colour =
    tone === 'success' ? 'text-emerald-700' : tone === 'warning' ? 'text-amber-700' : 'text-red-700'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs tracking-wide text-slate-500 uppercase">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${colour}`}>{value}</div>
    </div>
  )
}

// ---------- Groups tab ---------------------------------------------------

function GroupsTab({
  personId,
  memberships,
  allGroups,
}: {
  personId: string
  memberships: {
    membership: typeof personGroupMemberships.$inferSelect
    group: typeof personGroups.$inferSelect
  }[]
  allGroups: (typeof personGroups.$inferSelect)[]
}) {
  const memberIds = new Set(memberships.map((m) => m.group.id))
  const candidates = allGroups.filter((g) => !memberIds.has(g.id))
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users size={16} />
            Current groups
            <Badge variant="secondary">{memberships.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {memberships.length === 0 ? (
            <p className="text-sm text-slate-500">Not in any groups.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {memberships.map(({ group }) => (
                <li
                  key={group.id}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm"
                  style={group.color ? { borderColor: group.color, color: group.color } : undefined}
                >
                  {group.color ? (
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: group.color }}
                    />
                  ) : null}
                  <Link href={`/people/groups/${group.id}`} className="hover:underline">
                    {group.name}
                  </Link>
                  <form action={togglePersonInGroup} className="inline">
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="personId" value={personId} />
                    <button
                      type="submit"
                      title="Remove from group"
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 size={12} />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {candidates.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Available groups</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {candidates.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between rounded border border-slate-200 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {g.color ? (
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ background: g.color }}
                      />
                    ) : null}
                    <span className="font-medium">{g.name}</span>
                  </div>
                  <form action={togglePersonInGroup} className="inline">
                    <input type="hidden" name="groupId" value={g.id} />
                    <input type="hidden" name="personId" value={personId} />
                    <Button type="submit" size="sm" variant="outline">
                      Add
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

// ---------- Title tab ----------------------------------------------------

function TitleTab({
  personId,
  titlesHeld,
  allTitles,
  titleTasks,
  ackByTaskId,
}: {
  personId: string
  titlesHeld: {
    assignment: typeof personTitleAssignments.$inferSelect
    title: typeof personTitles.$inferSelect
  }[]
  allTitles: (typeof personTitles.$inferSelect)[]
  titleTasks: (typeof jobTitleTasks.$inferSelect)[]
  ackByTaskId: Map<string, typeof jobTitleTaskAcknowledgments.$inferSelect>
}) {
  const heldIds = new Set(titlesHeld.map((t) => t.title.id))
  const candidates = allTitles.filter((t) => !heldIds.has(t.id))
  // Group tasks by title to render the job-description sign-off list
  const tasksByTitle = new Map<string, (typeof jobTitleTasks.$inferSelect)[]>()
  for (const t of titleTasks) {
    if (!tasksByTitle.has(t.titleId)) tasksByTitle.set(t.titleId, [])
    tasksByTitle.get(t.titleId)!.push(t)
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IdCard size={16} />
            Current titles
            <Badge variant="secondary">{titlesHeld.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {titlesHeld.length === 0 ? (
            <p className="text-sm text-slate-500">No titles assigned.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {titlesHeld.map(({ assignment, title }) => (
                <li
                  key={assignment.id}
                  className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2"
                >
                  <Link
                    href={`/people/titles/${title.id}`}
                    className="flex-1 font-medium hover:underline"
                  >
                    {title.name}
                  </Link>
                  {assignment.isPrimary ? (
                    <Badge variant="success">Primary</Badge>
                  ) : (
                    <form action={setPrimaryTitle} className="inline">
                      <input type="hidden" name="titleId" value={title.id} />
                      <input type="hidden" name="personId" value={personId} />
                      <Button type="submit" size="sm" variant="ghost">
                        Make primary
                      </Button>
                    </form>
                  )}
                  <form action={unassignTitleFromPerson} className="inline">
                    <input type="hidden" name="titleId" value={title.id} />
                    <input type="hidden" name="personId" value={personId} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {candidates.length > 0 ? (
            <form
              action={assignTitleToPerson}
              className="mt-3 flex items-end gap-2 border-t border-slate-100 pt-3"
            >
              <input type="hidden" name="personId" value={personId} />
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="titleId">Assign new title</Label>
                <Select id="titleId" name="titleId" defaultValue="">
                  <option value="">— select —</option>
                  {candidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <input type="checkbox" name="isPrimary" />
                Primary
              </label>
              <Button type="submit">Assign</Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {titlesHeld.map(({ title }) => {
        const tasks = tasksByTitle.get(title.id) ?? []
        if (tasks.length === 0) return null
        const ackedCount = tasks.filter((t) => ackByTaskId.has(t.id)).length
        return (
          <Card key={title.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText size={16} />
                Job description — {title.name}
                <Badge variant={ackedCount === tasks.length ? 'success' : 'secondary'}>
                  {ackedCount}/{tasks.length} acknowledged
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-1 text-sm">
                {tasks.map((t, i) => {
                  const ack = ackByTaskId.get(t.id)
                  return (
                    <li
                      key={t.id}
                      className="flex items-start gap-3 rounded border border-slate-200 px-3 py-2"
                    >
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">{t.task}</div>
                        {t.description ? (
                          <div className="text-xs text-slate-500">{t.description}</div>
                        ) : null}
                        {ack ? (
                          <div className="mt-0.5 text-xs text-emerald-700">
                            Acknowledged {new Date(ack.acknowledgedAt).toLocaleDateString()}
                          </div>
                        ) : null}
                      </div>
                      {ack ? (
                        <form action={revokeTitleTaskAck} className="inline">
                          <input type="hidden" name="taskId" value={t.id} />
                          <input type="hidden" name="personId" value={personId} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            className="text-emerald-700"
                          >
                            <CheckSquare size={14} />
                          </Button>
                        </form>
                      ) : (
                        <form action={acknowledgeTitleTask} className="inline">
                          <input type="hidden" name="taskId" value={t.id} />
                          <input type="hidden" name="personId" value={personId} />
                          <Button type="submit" size="sm" variant="outline">
                            <Square size={14} />
                            Acknowledge
                          </Button>
                        </form>
                      )}
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ---------- Compliance tab -----------------------------------------------

function ComplianceTab({
  trainingTotal,
  trainingValid,
  trainingExpiring,
  trainingExpired,
  documentsAcked,
  ppeCount,
  titleTaskTotal,
  titleTaskAckedCount,
  incidentsCount,
}: {
  trainingTotal: number
  trainingValid: number
  trainingExpiring: number
  trainingExpired: number
  documentsAcked: number
  ppeCount: number
  titleTaskTotal: number
  titleTaskAckedCount: number
  incidentsCount: number
}) {
  const trainingPct = trainingTotal === 0 ? null : Math.round((trainingValid / trainingTotal) * 100)
  const titleTaskPct =
    titleTaskTotal === 0 ? null : Math.round((titleTaskAckedCount / titleTaskTotal) * 100)
  const overdueCount = trainingExpired
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <BigStatCard
        icon={<BadgeCheck size={20} />}
        title="Training compliance"
        primary={trainingPct === null ? '—' : `${trainingPct}%`}
        accent={
          trainingPct === null
            ? 'neutral'
            : trainingPct >= 95
              ? 'success'
              : trainingPct >= 80
                ? 'warning'
                : 'destructive'
        }
        detail={[
          `${trainingValid} valid`,
          `${trainingExpiring} expiring soon`,
          `${trainingExpired} expired`,
        ]}
      />
      <BigStatCard
        icon={<ShieldCheck size={20} />}
        title="Document acknowledgements"
        primary={`${documentsAcked}`}
        accent="neutral"
        detail={[
          documentsAcked === 0
            ? 'No documents acknowledged'
            : `${documentsAcked} document${documentsAcked === 1 ? '' : 's'} signed`,
        ]}
      />
      <BigStatCard
        icon={<HardHat size={20} />}
        title="PPE assignments"
        primary={`${ppeCount}`}
        accent="neutral"
        detail={[
          ppeCount === 0
            ? 'No PPE currently issued'
            : `${ppeCount} piece${ppeCount === 1 ? '' : 's'} of PPE assigned`,
        ]}
      />
      <BigStatCard
        icon={<FileText size={20} />}
        title="Job description acknowledgements"
        primary={titleTaskPct === null ? '—' : `${titleTaskPct}%`}
        accent={
          titleTaskPct === null
            ? 'neutral'
            : titleTaskPct === 100
              ? 'success'
              : titleTaskPct >= 50
                ? 'warning'
                : 'destructive'
        }
        detail={[
          titleTaskTotal === 0
            ? 'No tasks for assigned titles'
            : `${titleTaskAckedCount} of ${titleTaskTotal} tasks acknowledged`,
        ]}
      />
      <BigStatCard
        icon={<HardHat size={20} />}
        title="Overdue items"
        primary={`${overdueCount}`}
        accent={overdueCount > 0 ? 'destructive' : 'success'}
        detail={[
          overdueCount === 0
            ? 'Nothing overdue — keep it up.'
            : `${overdueCount} expired training record${overdueCount === 1 ? '' : 's'}`,
        ]}
      />
      <BigStatCard
        icon={<HardHat size={20} />}
        title="Recent incidents"
        primary={`${incidentsCount}`}
        accent={incidentsCount === 0 ? 'success' : 'neutral'}
        detail={[
          incidentsCount === 0
            ? 'Not involved in any incidents.'
            : `${incidentsCount} incident${incidentsCount === 1 ? '' : 's'} on record`,
        ]}
      />
    </div>
  )
}

function BigStatCard({
  icon,
  title,
  primary,
  accent,
  detail,
}: {
  icon: React.ReactNode
  title: string
  primary: string
  accent: 'success' | 'warning' | 'destructive' | 'neutral'
  detail: string[]
}) {
  const colour =
    accent === 'success'
      ? 'text-emerald-700'
      : accent === 'warning'
        ? 'text-amber-700'
        : accent === 'destructive'
          ? 'text-red-700'
          : 'text-slate-700'
  const borderColour =
    accent === 'success'
      ? 'border-emerald-200'
      : accent === 'warning'
        ? 'border-amber-200'
        : accent === 'destructive'
          ? 'border-red-200'
          : 'border-slate-200'
  return (
    <Card className={borderColour}>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-sm text-slate-700">
          <span className={colour}>{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-4xl font-semibold tabular-nums ${colour}`}>{primary}</div>
        <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
          {detail.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
