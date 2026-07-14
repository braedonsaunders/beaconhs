import { notFound } from 'next/navigation'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm'
import {
  Award,
  BadgeCheck,
  FileText,
  HardHat,
  IdCard,
  Mail,
  Paperclip,
  Phone,
  ShieldCheck,
  Trash2,
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
  incidentInjuries,
  incidentPeople,
  incidents,
  people,
  personFiles,
  personGroupMemberships,
  personGroups,
  personTitleAssignments,
  personTitles,
  ppeIssues,
  ppeItems,
  ppeTypes,
  tenantUsers,
  trades,
  trainingCourses,
  trainingRecords,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
  users,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { materializeIdentityAudienceObligations } from '@beaconhs/compliance'
import { attachmentUrl } from '@/lib/attachment-url'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { recentActivityForEntity, recordAuditInTransaction } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { RawImage } from '@/components/raw-image'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { LiveField, LivePersonSelect, LiveRichText, LiveSelect } from '@/components/live-field'
import { LiveMultiSelect } from '@/components/live-multi-select'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { isUuid, pickString } from '@/lib/list-params'
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section'
import { assertCanManageModule, canManageModule } from '@/lib/module-admin/guard'
import { moduleScopeWhere } from '@/lib/visibility'
import {
  getPersonSyncOrigin,
  SYNC_OWNED_PERSON_FIELDS,
  SYNC_OWNED_PERSON_RELATIONSHIPS,
} from '@/lib/people-sync'
import { PageContainer } from '@/components/page-layout'
import { setPersonGroups } from '../_actions/groups'
import { setPersonTitles, setPrimaryPersonTitle } from '../_actions/titles'
import { deletePersonFile } from '../_actions/files'
import { PersonFilesDrawers } from './_files-drawers'

export const dynamic = 'force-dynamic'

const TABS = [
  'overview',
  'compliance',
  'training',
  'skills',
  'ppe',
  'documents',
  'incidents',
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
const COMPLIANCE_AUDIENCE_FIELDS = new Set(['status', 'departmentId', 'tradeId'])

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

  await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(people)
      .where(and(eq(people.tenantId, ctx.tenantId), eq(people.id, id), isNull(people.deletedAt)))
      .limit(1)
      .for('update')
    if (!row) throw new Error('Person not found')
    const origin = row ? await getPersonSyncOrigin(tx, id) : null

    // Server-side half of the sync lock: a synced person's identity fields are
    // owned by the source — reject the write outright.
    if (origin && SYNC_OWNED_FIELDS.has(field)) {
      throw new Error('Field is managed by an external sync and is read-only')
    }

    // A person can never be their own manager.
    if (field === 'managerPersonId' && rawValue === id) return

    // Required identity fields must not be blanked (only reachable when not synced).
    if ((field === 'firstName' || field === 'lastName') && !rawValue) {
      throw new Error('First and last name are required')
    }

    let value: string | null = rawValue || null
    if (field === 'firstName' || field === 'lastName') {
      value = rawValue
    } else if (field === 'notes') {
      // Notes is a rich-text field — persist sanitized HTML (defense-in-depth
      // alongside the render-side sanitize), or null when effectively blank.
      value = rawValue ? sanitizeDocumentHtml(rawValue) : null
    } else if (field === 'status') {
      if (!(PERSON_STATUSES as readonly string[]).includes(rawValue)) {
        throw new Error('Invalid status')
      }
      value = rawValue
    }

    const beforeValue = (row as Record<string, unknown>)[field]
    if (beforeValue === value) return
    const [updated] = await tx
      .update(people)
      .set({ [field]: value } as Partial<typeof people.$inferInsert>)
      .where(and(eq(people.tenantId, ctx.tenantId), eq(people.id, id), isNull(people.deletedAt)))
      .returning({ id: people.id })
    if (!updated) throw new Error('Person no longer exists')
    if (COMPLIANCE_AUDIENCE_FIELDS.has(field)) {
      await materializeIdentityAudienceObligations(tx, ctx.tenantId, [id])
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person',
      entityId: id,
      action: 'update',
      summary: `Person ${field} updated`,
      before: { [field]: beforeValue },
      after: { [field]: value },
    })
  })
  revalidatePath(`/people/${id}`)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  // Use the person's name as the document title so back links that land here
  // from elsewhere read "Back to Jamie Arsenault", not "Back to Person".
  try {
    const ctx = await requireRequestContext()
    const name = await ctx.db(async (tx) => {
      const [row] = await tx
        .select({ firstName: people.firstName, lastName: people.lastName })
        .from(people)
        .where(and(eq(people.id, id), isNull(people.deletedAt)))
        .limit(1)
      return row ? `${row.firstName} ${row.lastName}`.trim() : null
    })
    if (name) return { title: name }
  } catch {
    // Fall through to the id-based title if context/lookup isn't available.
  }
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
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')

  const ctx = await requireRequestContext()
  const canEdit = canManageModule(ctx, 'people')
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        person: people,
        department: departments,
        trade: trades,
        crew: crews,
        photoKey: attachments.r2Key,
      })
      .from(people)
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .leftJoin(trades, eq(trades.id, people.tradeId))
      .leftJoin(crews, eq(crews.id, people.crewId))
      .leftJoin(attachments, eq(attachments.id, people.photoAttachmentId))
      .where(and(eq(people.id, id), isNull(people.deletedAt)))
      .limit(1)
    if (!row) return null

    // Incident data on this page must honor the viewer's incidents read tier —
    // same predicate the /incidents list applies, plus "the profile person is
    // me" so workers still see their own involvement on their own page.
    const [involvementVis, injuryVis] = await Promise.all([
      moduleScopeWhere(ctx, tx, {
        prefix: 'incidents',
        ownerCols: [incidents.reportedByTenantUserId],
        siteCol: incidents.siteOrgUnitId,
        personCol: incidentPeople.personId,
      }),
      moduleScopeWhere(ctx, tx, {
        prefix: 'incidents',
        ownerCols: [incidents.reportedByTenantUserId],
        siteCol: incidents.siteOrgUnitId,
        personCol: incidentInjuries.personId,
      }),
    ])

    const [
      training,
      skills,
      incidentInvolvement,
      injuryRows,
      ppeAssigned,
      ppeIssueLog,
      ackedDocs,
      personGroupRows,
      allGroups,
      personTitleRows,
      allTitles,
      fileRows,
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
        .where(
          and(
            eq(incidentPeople.personId, id),
            isNull(incidents.deletedAt),
            ...(involvementVis ? [involvementVis] : []),
          ),
        )
        .orderBy(desc(incidents.occurredAt)),
      tx
        .select({ injury: incidentInjuries, incident: incidents })
        .from(incidentInjuries)
        .innerJoin(incidents, eq(incidents.id, incidentInjuries.incidentId))
        .where(
          and(
            eq(incidentInjuries.personId, id),
            isNull(incidents.deletedAt),
            ...(injuryVis ? [injuryVis] : []),
          ),
        )
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
        .where(and(eq(personTitleAssignments.personId, id), isNull(personTitles.deletedAt)))
        .orderBy(desc(personTitleAssignments.isPrimary), asc(personTitles.name)),
      tx
        .select()
        .from(personTitles)
        .where(isNull(personTitles.deletedAt))
        .orderBy(asc(personTitles.name)),
      // Personal files (resumes, certs, ID copies) joined to their underlying
      // attachment row so we can render a download link inline.
      tx
        .select({ file: personFiles, attachment: attachments })
        .from(personFiles)
        .leftJoin(attachments, eq(attachments.id, personFiles.attachmentId))
        .where(eq(personFiles.personId, id))
        .orderBy(desc(personFiles.uploadedAt)),
      // Manager for the side-panel "reports to" row + a quick org-chart link.
      row.person.managerPersonId
        ? tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
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
        .where(and(ne(people.id, id), eq(people.status, 'active'), isNull(people.deletedAt)))
        .orderBy(asc(people.lastName), asc(people.firstName)),
      getPersonSyncOrigin(tx, id),
    ])

    // Read-only view of the login account this person is linked to (managed from
    // Admin → Users). membershipId lets an admin jump straight to that page.
    const linkedAccount = row.person.userId
      ? ((
          await tx
            .select({
              membershipId: tenantUsers.id,
              email: users.email,
            })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(tenantUsers.userId, row.person.userId))
            .limit(1)
        )[0] ?? null)
      : null

    return {
      ...row,
      photoUrl: row.person.photoAttachmentId ? attachmentUrl(row.person.photoAttachmentId) : null,
      linkedAccount,
      training,
      skills,
      incidentInvolvement,
      injuryRows,
      ppeAssigned,
      ppeIssueLog,
      ackedDocs,
      personGroupRows,
      allGroups,
      personTitleRows,
      allTitles,
      fileRows,
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
    personGroupRows,
    allGroups,
    personTitleRows,
    allTitles,
    fileRows,
    managerRow,
    deptOptions,
    tradeOptions,
    crewOptions,
    managerOptions,
    syncOrigin,
    linkedAccount,
    photoUrl,
  } = data
  const openDrawer = typeof sp.drawer === 'string' ? sp.drawer : null
  const basePathForDrawer = `/people/${id}${active === 'overview' ? '' : `?tab=${active}`}`
  const synced = syncOrigin != null
  const titlesManagedBySync =
    synced && (SYNC_OWNED_PERSON_RELATIONSHIPS as readonly string[]).includes('titles')
  const primaryTitle = personTitleRows.find((row) => row.assignment.isPrimary)?.title ?? null
  // Files and the saved signature are manage-or-self: a person may maintain
  // their own; everyone else needs the module permission (the server actions
  // re-assert this).
  const isSelf = person.userId != null && person.userId === ctx.userId
  const canEditFiles = canEdit || isSelf
  // A field's input is read-only when the viewer lacks edit permission, OR the
  // person is synced and this is a sync-owned field.
  const fieldDisabled = (field: string) => !canEdit || (synced && SYNC_OWNED_FIELDS.has(field))

  const today = new Date()
  // Transcript = the person's CURRENT standing per course. `training` is ordered
  // newest-completed-first, so the first row seen for a course is its most recent
  // record; older rows for the same course are superseded (e.g. an expired cert
  // that has since been renewed) and must not show as separate expired lines.
  const seenCourseIds = new Set<string>()
  const latestPerCourse = training.filter((t) => {
    if (seenCourseIds.has(t.course.id)) return false
    seenCourseIds.add(t.course.id)
    return true
  })
  const supersededCount = training.length - latestPerCourse.length
  const transcript = latestPerCourse
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

  // Transcript sub-table: URL-driven search + pagination via prefixed params so
  // it never fights the other tabs for `q`/`page`.
  const transcriptQuery = (pickString(sp.tq) ?? '').trim().toLowerCase()
  const filteredTranscript = transcriptQuery
    ? transcript.filter((t) => {
        const hay = `${t.course.name} ${t.course.code ?? ''}`.toLowerCase()
        return hay.includes(transcriptQuery)
      })
    : transcript
  const TRANSCRIPT_PER_PAGE = 10
  const transcriptPage = Math.max(1, Number(pickString(sp.tpage) ?? '1') || 1)
  const transcriptPageRows = filteredTranscript.slice(
    (transcriptPage - 1) * TRANSCRIPT_PER_PAGE,
    transcriptPage * TRANSCRIPT_PER_PAGE,
  )

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

  const expiredCount = transcript.filter((t) => t.status === 'expired').length
  const expiringCount = transcript.filter((t) => t.status === 'expiring').length
  const validCount = transcript.filter((t) => t.status === 'ok').length

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
          badge={
            <Badge variant={person.status === 'active' ? 'success' : 'secondary'}>
              {person.status}
            </Badge>
          }
          actions={
            canEdit ? (
              <Button asChild variant="outline" size="sm">
                <a href={`${basePath}/badge`} target="_blank" rel="noreferrer">
                  <IdCard size={14} /> ID badge
                </a>
              </Button>
            ) : undefined
          }
        />

        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-3">
            <Card>
              <CardContent className="space-y-3 p-5 text-sm">
                <div className="flex flex-col items-center gap-2 pb-3">
                  {photoUrl ? (
                    <RawImage
                      src={photoUrl}
                      alt={`${person.firstName} ${person.lastName}`}
                      optimizationReason="authenticated"
                      className="h-20 w-20 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-teal-100 text-2xl font-semibold text-teal-800 dark:bg-teal-500/15 dark:text-teal-300">
                      {person.firstName[0]}
                      {person.lastName[0]}
                    </div>
                  )}
                  <div className="text-center">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {primaryTitle?.name ?? '—'}
                    </div>
                    {trade?.name ? (
                      <div className="text-xs text-slate-500">{trade.name}</div>
                    ) : null}
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
                <SidebarRow label="App account">
                  {linkedAccount ? (
                    can(ctx, 'admin.users.manage') ? (
                      <Link
                        href={`/admin/users/${linkedAccount.membershipId}`}
                        className="text-teal-700 hover:underline"
                        title={linkedAccount.email}
                      >
                        {linkedAccount.email}
                      </Link>
                    ) : (
                      <span title={linkedAccount.email}>{linkedAccount.email}</span>
                    )
                  ) : (
                    'Not linked'
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
          </aside>

          <div className="space-y-4">
            <TabNav
              basePath={basePath}
              currentParams={sp}
              active={active}
              variant="pills"
              tabs={[
                { key: 'overview', label: 'Overview' },
                { key: 'compliance', label: 'Compliance' },
                {
                  key: 'training',
                  label: 'Transcript',
                  count: transcript.length,
                },
                { key: 'skills', label: 'Skills', count: skills.length },
                { key: 'ppe', label: 'PPE', count: ppeAssigned.length },
                {
                  key: 'documents',
                  label: 'Documents & files',
                  count: fileRows.length,
                },
                {
                  key: 'incidents',
                  label: 'Incidents',
                  count: allIncidents.length,
                },
                { key: 'activity', label: 'Activity' },
              ]}
            />

            {active === 'overview' ? (
              <div className="space-y-4">
                {!canEdit ? (
                  <Alert variant="info">
                    <AlertTitle>Read-only</AlertTitle>
                    <AlertDescription>
                      You do not have permission to edit this person.
                    </AlertDescription>
                  </Alert>
                ) : null}
                {syncOrigin ? (
                  <Alert variant="info">
                    <AlertTitle>Managed by {syncOrigin.connectionName}</AlertTitle>
                    <AlertDescription>
                      Identity fields and job titles come from this active connection. Update them
                      in the source system; app-owned fields remain editable here.
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
                      field="primaryTitleId"
                      label="Primary job title"
                      initialValue={primaryTitle?.id ?? null}
                      allowEmpty={personTitleRows.length === 0}
                      options={allTitles.map((title) => ({
                        value: title.id,
                        label: title.name,
                      }))}
                      disabled={!canEdit || titlesManagedBySync}
                      updateAction={setPrimaryPersonTitle}
                    />
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

                <Section title="Groups & titles" subtitle="Tags and job titles this person holds">
                  <div className="space-y-4">
                    <LiveMultiSelect
                      id={person.id}
                      label="Groups"
                      initialValue={personGroupRows.map((r) => r.group.id)}
                      options={allGroups.map((g) => ({
                        value: g.id,
                        label: g.name,
                        color: g.color,
                      }))}
                      disabled={!canEdit}
                      updateAction={setPersonGroups}
                      placeholder="Add to a group…"
                      sheetTitle="Add to group"
                    />
                    <LiveMultiSelect
                      id={person.id}
                      label="Held titles"
                      initialValue={personTitleRows.map((r) => r.title.id)}
                      options={allTitles.map((t) => ({ value: t.id, label: t.name }))}
                      disabled={!canEdit || titlesManagedBySync}
                      updateAction={setPersonTitles}
                      placeholder="Assign a title…"
                      sheetTitle="Assign title"
                    />
                  </div>
                </Section>

                <Section title="Notes" subtitle="Internal notes about this person">
                  <LiveRichText
                    id={person.id}
                    field="notes"
                    label="Notes"
                    initialValue={person.notes}
                    placeholder="Add internal notes about this person…"
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

            {active === 'compliance' ? (
              <ComplianceTab
                trainingTotal={transcript.length}
                trainingValid={transcript.filter((t) => t.status === 'ok').length}
                trainingExpiring={expiringCount}
                trainingExpired={expiredCount}
                documentsAcked={ackedDocs.length}
                ppeCount={ppeAssigned.length}
                incidentsCount={allIncidents.length}
              />
            ) : null}

            {active === 'training' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    Compliance
                  </span>
                  <CompactStat label="Valid" value={validCount} tone="success" />
                  <CompactStat label="Expiring ≤30d" value={expiringCount} tone="warning" />
                  <CompactStat label="Expired" value={expiredCount} tone="destructive" />
                </div>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-3">
                    <CardTitle>Transcript</CardTitle>
                    <SearchInput placeholder="Search courses…" paramKey="tq" pageParamKey="tpage" />
                  </CardHeader>
                  <CardContent>
                    {transcript.length === 0 ? (
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
                    ) : filteredTranscript.length === 0 ? (
                      <EmptyState
                        icon={<FileText size={24} />}
                        title={`No courses match “${pickString(sp.tq) ?? ''}”`}
                        description="Try a different search term."
                      />
                    ) : (
                      <>
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
                            {transcriptPageRows.map((row) => (
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
                        <Pagination
                          basePath={basePath}
                          currentParams={sp}
                          total={filteredTranscript.length}
                          page={transcriptPage}
                          perPage={TRANSCRIPT_PER_PAGE}
                          pageParamKey="tpage"
                        />
                        {supersededCount > 0 ? (
                          <p className="px-3 pt-1 text-xs text-slate-400 dark:text-slate-500">
                            Showing the most recent record per course. {supersededCount} older
                            superseded {supersededCount === 1 ? 'record is' : 'records are'} hidden
                            — view the{' '}
                            <Link
                              href={`/training/records?personId=${id}` as any}
                              className="text-teal-700 hover:underline dark:text-teal-400"
                            >
                              training module
                            </Link>{' '}
                            for full history.
                          </p>
                        ) : null}
                      </>
                    )}
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
                                {formatDate(
                                  new Date(row.issue.occurredAt),
                                  ctx.timezone,
                                  ctx.locale,
                                )}
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
                      {canEditFiles ? (
                        <Link href={`${basePath}?tab=documents&drawer=upload-person-file`}>
                          <Button size="sm">Upload file</Button>
                        </Link>
                      ) : null}
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
                                    href={attachmentUrl(attachment.id)}
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
                                {formatDate(new Date(file.uploadedAt), ctx.timezone, ctx.locale)}
                              </TableCell>
                              <TableCell>
                                {canEditFiles ? (
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
                                ) : null}
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
                              {formatDate(new Date(incident.occurredAt), ctx.timezone, ctx.locale)}
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

            {active === 'activity' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
      {canEditFiles ? (
        <PersonFilesDrawers
          personId={person.id}
          openDrawer={openDrawer === 'upload-person-file' ? openDrawer : null}
          closeHref={basePathForDrawer}
        />
      ) : null}
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

/** Compact inline stat — a colored number with a small label, for the dense
 * one-row transcript compliance summary. */
function CompactStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'success' | 'warning' | 'destructive'
}) {
  const colour =
    tone === 'success'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'warning'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-red-700 dark:text-red-400'
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`text-lg font-semibold tabular-nums ${colour}`}>{value}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
    </span>
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
  incidentsCount,
}: {
  trainingTotal: number
  trainingValid: number
  trainingExpiring: number
  trainingExpired: number
  documentsAcked: number
  ppeCount: number
  incidentsCount: number
}) {
  const trainingPct = trainingTotal === 0 ? null : Math.round((trainingValid / trainingTotal) * 100)
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
