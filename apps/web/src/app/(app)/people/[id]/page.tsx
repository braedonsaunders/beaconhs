import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'
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
  tenants,
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
import { CardPressoPrintButton } from '@/components/cardpresso-print-button'
import { cardPressoConfigured } from '@/lib/cardpresso'
import { normalizePersonBadgeDesign } from '@/lib/person-badge-design'
import { renderPersonBadgePreview } from '@/lib/person-badge'
import { CredentialFlipCard } from '@/components/credential-flip-card'
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
  const tGenerated = await getGeneratedTranslations()
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
  return { title: tGenerated('m_0755f33f8a190e', { value0: id.slice(0, 8) }) }
}

export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
        tenantSettings: tenants.settings,
      })
      .from(people)
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .leftJoin(trades, eq(trades.id, people.tradeId))
      .leftJoin(crews, eq(crews.id, people.crewId))
      .leftJoin(attachments, eq(attachments.id, people.photoAttachmentId))
      .innerJoin(tenants, eq(tenants.id, people.tenantId))
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
  const badgePreview = canEdit ? await renderPersonBadgePreview(ctx, id) : null

  const basePath = `/people/${id}`
  const badgeUsesCardPresso = normalizePersonBadgeDesign(data.tenantSettings).artboards.some(
    (artboard) => artboard.printProfile?.provider === 'cardpresso-wps',
  )
  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/people', label: 'Back to people' }}
          title={tGeneratedValue(`${person.firstName} ${person.lastName}`)}
          badge={
            <Badge variant={person.status === 'active' ? 'success' : 'secondary'}>
              <GeneratedValue value={person.status} />
            </Badge>
          }
          actions={
            canEdit ? (
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={`${basePath}/badge`} target="_blank" rel="noreferrer">
                    <IdCard size={14} /> <GeneratedText id="m_1036403447ff0f" />
                  </a>
                </Button>
                <GeneratedValue
                  value={
                    badgeUsesCardPresso ? (
                      <CardPressoPrintButton
                        endpoint={`${basePath}/badge/print`}
                        disabled={!cardPressoConfigured()}
                      />
                    ) : null
                  }
                />
              </div>
            ) : undefined
          }
        />

        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-3">
            <Card>
              <CardContent className="space-y-3 p-5 text-sm">
                <div className="flex flex-col items-center gap-2 pb-3">
                  <GeneratedValue
                    value={
                      photoUrl ? (
                        <RawImage
                          src={photoUrl}
                          alt={tGeneratedValue(`${person.firstName} ${person.lastName}`)}
                          optimizationReason="authenticated"
                          className="h-20 w-20 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-teal-100 text-2xl font-semibold text-teal-800 dark:bg-teal-500/15 dark:text-teal-300">
                          <GeneratedValue value={person.firstName[0]} />
                          <GeneratedValue value={person.lastName[0]} />
                        </div>
                      )
                    }
                  />
                  <div className="text-center">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      <GeneratedValue value={primaryTitle?.name ?? '—'} />
                    </div>
                    <GeneratedValue
                      value={
                        trade?.name ? (
                          <div className="text-xs text-slate-500">
                            <GeneratedValue value={trade.name} />
                          </div>
                        ) : null
                      }
                    />
                  </div>
                </div>
                <SidebarRow label={tGenerated('m_0230d1a18b5206')}>
                  <GeneratedValue value={person.employeeNo ?? '—'} />
                </SidebarRow>
                <SidebarRow label={tGenerated('m_1af68228b8305a')}>
                  <GeneratedValue value={department?.name ?? '—'} />
                </SidebarRow>
                <SidebarRow label={tGenerated('m_13fc63a82a07d0')}>
                  <GeneratedValue value={crew?.name ?? '—'} />
                </SidebarRow>
                <SidebarRow label={tGenerated('m_1bd874d72669b8')}>
                  <GeneratedValue value={person.hireDate ?? '—'} />
                </SidebarRow>
                <SidebarRow label={tGenerated('m_10b68359e74254')}>
                  <GeneratedValue
                    value={
                      managerRow ? (
                        <Link
                          href={`/people/${managerRow.id}`}
                          className="text-teal-700 hover:underline"
                        >
                          <GeneratedValue value={managerRow.firstName} />{' '}
                          <GeneratedValue value={managerRow.lastName} />
                        </Link>
                      ) : (
                        '—'
                      )
                    }
                  />
                </SidebarRow>
                <SidebarRow label={tGenerated('m_0c147e34519f36')}>
                  <GeneratedValue
                    value={
                      linkedAccount ? (
                        can(ctx, 'admin.users.manage') ? (
                          <Link
                            href={`/admin/users/${linkedAccount.membershipId}`}
                            className="text-teal-700 hover:underline"
                            title={tGeneratedValue(linkedAccount.email)}
                          >
                            <GeneratedValue value={linkedAccount.email} />
                          </Link>
                        ) : (
                          <span title={tGeneratedValue(linkedAccount.email)}>
                            <GeneratedValue value={linkedAccount.email} />
                          </span>
                        )
                      ) : (
                        <GeneratedText id="m_061e6df5204794" />
                      )
                    }
                  />
                </SidebarRow>
                <GeneratedValue
                  value={
                    person.email ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail size={14} className="text-slate-400" />
                        <a
                          href={`mailto:${person.email}`}
                          className="text-teal-700 hover:underline"
                        >
                          <GeneratedValue value={person.email} />
                        </a>
                      </div>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    person.phone ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone size={14} className="text-slate-400" />
                        <a href={`tel:${person.phone}`} className="text-teal-700 hover:underline">
                          <GeneratedValue value={person.phone} />
                        </a>
                      </div>
                    ) : null
                  }
                />
              </CardContent>
            </Card>
            <GeneratedValue
              value={
                badgePreview ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">
                        <GeneratedValue value="ID badge preview" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CredentialFlipCard {...badgePreview} />
                    </CardContent>
                  </Card>
                ) : null
              }
            />
            <GeneratedValue
              value={
                person.emergencyContactName || person.emergencyContactPhone ? (
                  <Card className="border-red-200">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-red-800">
                        <GeneratedText id="m_1c4b8371cb1596" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 pt-0 text-sm">
                      <div className="font-medium">
                        <GeneratedValue value={person.emergencyContactName ?? '—'} />
                      </div>
                      <GeneratedValue
                        value={
                          person.emergencyContactPhone ? (
                            <a
                              href={`tel:${person.emergencyContactPhone}`}
                              className="text-teal-700 hover:underline"
                            >
                              <GeneratedValue value={person.emergencyContactPhone} />
                            </a>
                          ) : null
                        }
                      />
                    </CardContent>
                  </Card>
                ) : null
              }
            />
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

            <GeneratedValue
              value={
                active === 'overview' ? (
                  <div className="space-y-4">
                    <GeneratedValue
                      value={
                        !canEdit ? (
                          <Alert variant="info">
                            <AlertTitle>
                              <GeneratedText id="m_0fdc17678fae80" />
                            </AlertTitle>
                            <AlertDescription>
                              <GeneratedText id="m_078315010f70e4" />
                            </AlertDescription>
                          </Alert>
                        ) : null
                      }
                    />
                    <GeneratedValue
                      value={
                        syncOrigin ? (
                          <Alert variant="info">
                            <AlertTitle>
                              <GeneratedText id="m_147b8803799f06" />{' '}
                              <GeneratedValue value={syncOrigin.connectionName} />
                            </AlertTitle>
                            <AlertDescription>
                              <GeneratedText id="m_02191f52e79239" />
                            </AlertDescription>
                          </Alert>
                        ) : null
                      }
                    />

                    <Section
                      title={tGenerated('m_1b2eb1ab6d7edc')}
                      subtitle={tGenerated('m_11cc3c77f4e22f')}
                    >
                      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                        <LiveField
                          id={person.id}
                          field="firstName"
                          label={tGenerated('m_07cc2555a1b765')}
                          initialValue={person.firstName}
                          disabled={fieldDisabled('firstName')}
                          updateAction={updatePersonField}
                        />
                        <LiveField
                          id={person.id}
                          field="lastName"
                          label={tGenerated('m_0e7d90a2ba2038')}
                          initialValue={person.lastName}
                          disabled={fieldDisabled('lastName')}
                          updateAction={updatePersonField}
                        />
                        <LiveField
                          id={person.id}
                          field="formalName"
                          label={tGenerated('m_157d9bc83116b9')}
                          initialValue={person.formalName}
                          disabled={fieldDisabled('formalName')}
                          updateAction={updatePersonField}
                        />
                        <LiveField
                          id={person.id}
                          field="dateOfBirth"
                          label={tGenerated('m_1c4bc57e4c9de9')}
                          type="date"
                          initialValue={person.dateOfBirth}
                          disabled={fieldDisabled('dateOfBirth')}
                          updateAction={updatePersonField}
                        />
                        <LiveField
                          id={person.id}
                          field="employeeNo"
                          label={tGenerated('m_0230d1a18b5206')}
                          initialValue={person.employeeNo}
                          disabled={fieldDisabled('employeeNo')}
                          updateAction={updatePersonField}
                        />
                        <LiveField
                          id={person.id}
                          field="email"
                          label={tGenerated('m_00a0ba9938bdff')}
                          initialValue={person.email}
                          disabled={fieldDisabled('email')}
                          updateAction={updatePersonField}
                        />
                        <LiveField
                          id={person.id}
                          field="phone"
                          label={tGenerated('m_129b102b56bf3a')}
                          initialValue={person.phone}
                          disabled={fieldDisabled('phone')}
                          updateAction={updatePersonField}
                        />
                      </div>
                    </Section>

                    <Section
                      title={tGenerated('m_04a447b0e8003b')}
                      subtitle={tGenerated('m_1d7da8d570e8f4')}
                    >
                      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                        <LiveSelect
                          id={person.id}
                          field="primaryTitleId"
                          label={tGenerated('m_1a4bbe2908d1a5')}
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
                          label={tGenerated('m_0b9da892d6faf0')}
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
                          label={tGenerated('m_1bd874d72669b8')}
                          type="date"
                          initialValue={person.hireDate}
                          disabled={fieldDisabled('hireDate')}
                          updateAction={updatePersonField}
                        />
                        <LiveField
                          id={person.id}
                          field="terminationDate"
                          label={tGenerated('m_0cc426c0b81f98')}
                          type="date"
                          initialValue={person.terminationDate}
                          disabled={fieldDisabled('terminationDate')}
                          updateAction={updatePersonField}
                        />
                        <LiveSelect
                          id={person.id}
                          field="departmentId"
                          label={tGenerated('m_1af68228b8305a')}
                          initialValue={person.departmentId}
                          options={deptOptions.map((d) => ({ value: d.id, label: d.name }))}
                          disabled={fieldDisabled('departmentId')}
                          updateAction={updatePersonField}
                        />
                        <LiveSelect
                          id={person.id}
                          field="tradeId"
                          label={tGenerated('m_1f1e634a4380dc')}
                          initialValue={person.tradeId}
                          options={tradeOptions.map((t) => ({ value: t.id, label: t.name }))}
                          disabled={fieldDisabled('tradeId')}
                          updateAction={updatePersonField}
                        />
                        <LiveSelect
                          id={person.id}
                          field="crewId"
                          label={tGenerated('m_13fc63a82a07d0')}
                          initialValue={person.crewId}
                          options={crewOptions.map((c) => ({ value: c.id, label: c.name }))}
                          disabled={fieldDisabled('crewId')}
                          updateAction={updatePersonField}
                        />
                        <LiveField
                          id={person.id}
                          field="externalEmployeeId"
                          label={tGenerated('m_0ed5613d0cf4ad')}
                          placeholder={tGenerated('m_0dedb96e55d57e')}
                          initialValue={person.externalEmployeeId}
                          disabled={fieldDisabled('externalEmployeeId')}
                          updateAction={updatePersonField}
                        />
                        <LivePersonSelect
                          id={person.id}
                          field="managerPersonId"
                          label={tGenerated('m_10b68359e74254')}
                          initialValue={person.managerPersonId}
                          options={managerOptions.map((m) => ({
                            value: m.id,
                            label: `${m.lastName}, ${m.firstName}`,
                            hint: m.employeeNo ?? undefined,
                          }))}
                          sheetTitle="Select manager"
                          placeholder={tGenerated('m_0b842b664b4f3b')}
                          disabled={fieldDisabled('managerPersonId')}
                          updateAction={updatePersonField}
                        />
                      </div>
                    </Section>

                    <Section
                      title={tGenerated('m_1c4b8371cb1596')}
                      subtitle={tGenerated('m_08fe783cc4fa92')}
                    >
                      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                        <LiveField
                          id={person.id}
                          field="emergencyContactName"
                          label={tGenerated('m_102c76e353ed6c')}
                          initialValue={person.emergencyContactName}
                          disabled={fieldDisabled('emergencyContactName')}
                          updateAction={updatePersonField}
                        />
                        <LiveField
                          id={person.id}
                          field="emergencyContactPhone"
                          label={tGenerated('m_039e8d745aa6a6')}
                          initialValue={person.emergencyContactPhone}
                          disabled={fieldDisabled('emergencyContactPhone')}
                          updateAction={updatePersonField}
                        />
                      </div>
                    </Section>

                    <Section
                      title={tGenerated('m_115785120a1462')}
                      subtitle={tGenerated('m_04ab27496b7a08')}
                    >
                      <div className="space-y-4">
                        <LiveMultiSelect
                          id={person.id}
                          label={tGenerated('m_1668000fa2a811')}
                          initialValue={personGroupRows.map((r) => r.group.id)}
                          options={allGroups.map((g) => ({
                            value: g.id,
                            label: g.name,
                            color: g.color,
                          }))}
                          disabled={!canEdit}
                          updateAction={setPersonGroups}
                          placeholder={tGenerated('m_01c6e280f6d50a')}
                          sheetTitle="Add to group"
                        />
                        <LiveMultiSelect
                          id={person.id}
                          label={tGenerated('m_095c84f6f98817')}
                          initialValue={personTitleRows.map((r) => r.title.id)}
                          options={allTitles.map((t) => ({ value: t.id, label: t.name }))}
                          disabled={!canEdit || titlesManagedBySync}
                          updateAction={setPersonTitles}
                          placeholder={tGenerated('m_1d8fbe8844cf23')}
                          sheetTitle="Assign title"
                        />
                      </div>
                    </Section>

                    <Section
                      title={tGenerated('m_0b8dadcb78cd08')}
                      subtitle={tGenerated('m_1fb45a84c0088e')}
                    >
                      <LiveRichText
                        id={person.id}
                        field="notes"
                        label={tGenerated('m_0b8dadcb78cd08')}
                        initialValue={person.notes}
                        placeholder={tGenerated('m_022870b5381457')}
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
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'compliance' ? (
                  <ComplianceTab
                    trainingTotal={transcript.length}
                    trainingValid={transcript.filter((t) => t.status === 'ok').length}
                    trainingExpiring={expiringCount}
                    trainingExpired={expiredCount}
                    documentsAcked={ackedDocs.length}
                    ppeCount={ppeAssigned.length}
                    incidentsCount={allIncidents.length}
                  />
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'training' ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
                      <span className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                        <GeneratedText id="m_096d47f60747b3" />
                      </span>
                      <CompactStat
                        label={tGenerated('m_1e418d0475450c')}
                        value={validCount}
                        tone="success"
                      />
                      <CompactStat
                        label={tGenerated('m_1c459e8d8a0fdf')}
                        value={expiringCount}
                        tone="warning"
                      />
                      <CompactStat
                        label={tGenerated('m_13f7150c94b182')}
                        value={expiredCount}
                        tone="destructive"
                      />
                    </div>
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between gap-3">
                        <CardTitle>
                          <GeneratedText id="m_03f65fe93c92ce" />
                        </CardTitle>
                        <SearchInput
                          placeholder={tGenerated('m_030db64e0bf790')}
                          paramKey="tq"
                          pageParamKey="tpage"
                        />
                      </CardHeader>
                      <CardContent>
                        <GeneratedValue
                          value={
                            transcript.length === 0 ? (
                              <EmptyState
                                icon={<FileText size={24} />}
                                title={tGenerated('m_049950ab11f977')}
                                description={tGenerated('m_030cf08a1e2186')}
                                action={
                                  <Link href={`/training/records?personId=${id}` as any}>
                                    <Button variant="outline" size="sm">
                                      <GeneratedText id="m_0364a8e21f8023" />
                                    </Button>
                                  </Link>
                                }
                              />
                            ) : filteredTranscript.length === 0 ? (
                              <EmptyState
                                icon={<FileText size={24} />}
                                title={tGenerated('m_0868e7364f9501', {
                                  value0: pickString(sp.tq) ?? '',
                                })}
                                description={tGenerated('m_0dcfd55260344b')}
                              />
                            ) : (
                              <>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>
                                        <GeneratedText id="m_14fc1e0739b60e" />
                                      </TableHead>
                                      <TableHead>
                                        <GeneratedText id="m_0ba7a5e1b2fa32" />
                                      </TableHead>
                                      <TableHead>
                                        <GeneratedText id="m_14f3858b0a9ad6" />
                                      </TableHead>
                                      <TableHead>
                                        <GeneratedText id="m_0b9da892d6faf0" />
                                      </TableHead>
                                      <TableHead>
                                        <GeneratedText id="m_0d49c43e2afdff" />
                                      </TableHead>
                                      <TableHead></TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    <GeneratedValue
                                      value={transcriptPageRows.map((row) => (
                                        <TableRow key={row.record.id}>
                                          <TableCell className="font-medium">
                                            <Link
                                              href={`/training/records/${row.record.id}`}
                                              className="hover:underline"
                                            >
                                              <GeneratedValue value={row.course.name} />
                                            </Link>
                                            <div className="text-xs text-slate-500">
                                              <GeneratedValue value={row.course.code} />
                                            </div>
                                          </TableCell>
                                          <TableCell>
                                            <GeneratedValue value={row.record.completedOn} />
                                          </TableCell>
                                          <TableCell>
                                            <GeneratedValue value={row.record.expiresOn ?? '—'} />
                                          </TableCell>
                                          <TableCell>
                                            <GeneratedValue
                                              value={
                                                row.status === 'expired' ? (
                                                  <Badge variant="destructive">
                                                    <GeneratedText id="m_13f7150c94b182" />{' '}
                                                    {Math.abs(row.daysLeft!)}
                                                    <GeneratedText id="m_0ced4968a01894" />
                                                  </Badge>
                                                ) : row.status === 'expiring' ? (
                                                  <Badge variant="warning">
                                                    {row.daysLeft}
                                                    <GeneratedText id="m_0a3d63460246cf" />
                                                  </Badge>
                                                ) : row.status === 'ok' ? (
                                                  <Badge variant="success">
                                                    <GeneratedText id="m_1e418d0475450c" />
                                                  </Badge>
                                                ) : (
                                                  <Badge variant="secondary">
                                                    <GeneratedText id="m_1bbc44c1ce26a7" />
                                                  </Badge>
                                                )
                                              }
                                            />
                                          </TableCell>
                                          <TableCell>
                                            <GeneratedValue
                                              value={
                                                row.record.grade != null
                                                  ? `${row.record.grade}%`
                                                  : '—'
                                              }
                                            />
                                          </TableCell>
                                          <TableCell>
                                            <Link
                                              href={`/training/records/${row.record.id}`}
                                              className="text-xs text-teal-700 hover:underline"
                                            >
                                              <GeneratedText id="m_1be345fc118df8" />
                                            </Link>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    />
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
                                <GeneratedValue
                                  value={
                                    supersededCount > 0 ? (
                                      <p className="px-3 pt-1 text-xs text-slate-400 dark:text-slate-500">
                                        <GeneratedText id="m_1aafa78531c465" />{' '}
                                        <GeneratedValue value={supersededCount} />{' '}
                                        <GeneratedText id="m_0299e96cf3e305" />{' '}
                                        <GeneratedValue
                                          value={
                                            supersededCount === 1 ? (
                                              <GeneratedText id="m_09177ac36b3a87" />
                                            ) : (
                                              <GeneratedText id="m_12d361efef01d0" />
                                            )
                                          }
                                        />{' '}
                                        <GeneratedText id="m_064b15de5768de" />
                                        <GeneratedValue value={' '} />
                                        <Link
                                          href={`/training/records?personId=${id}` as any}
                                          className="text-teal-700 hover:underline dark:text-teal-400"
                                        >
                                          <GeneratedText id="m_11d6bcf3c30fe0" />
                                        </Link>
                                        <GeneratedValue value={' '} />
                                        <GeneratedText id="m_0203f1d56c0546" />
                                      </p>
                                    ) : null
                                  }
                                />
                              </>
                            )
                          }
                        />
                      </CardContent>
                    </Card>
                  </div>
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'skills' ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <GeneratedText id="m_08ac3bc5c6d094" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <GeneratedValue
                        value={
                          skillsWithStatus.length === 0 ? (
                            <EmptyState
                              icon={<Award size={24} />}
                              title={tGenerated('m_1ac1d9ebeaea06')}
                              description={tGenerated('m_0e10fa6d700bf4')}
                            />
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>
                                    <GeneratedText id="m_02e36ef7395a78" />
                                  </TableHead>
                                  <TableHead>
                                    <GeneratedText id="m_012397255c5bd0" />
                                  </TableHead>
                                  <TableHead>
                                    <GeneratedText id="m_10633978809d91" />
                                  </TableHead>
                                  <TableHead>
                                    <GeneratedText id="m_14f3858b0a9ad6" />
                                  </TableHead>
                                  <TableHead>
                                    <GeneratedText id="m_0b9da892d6faf0" />
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                <GeneratedValue
                                  value={skillsWithStatus.map((row) => (
                                    <TableRow key={row.assignment.id}>
                                      <TableCell className="font-medium">
                                        <GeneratedValue value={row.skillType.name} />
                                        <GeneratedValue
                                          value={
                                            row.skillType.code ? (
                                              <div className="font-mono text-xs text-slate-500">
                                                {row.skillType.code}
                                              </div>
                                            ) : null
                                          }
                                        />
                                      </TableCell>
                                      <TableCell className="text-slate-600">
                                        <GeneratedValue value={row.authority?.name ?? '—'} />
                                      </TableCell>
                                      <TableCell>
                                        <GeneratedValue value={row.assignment.grantedOn} />
                                      </TableCell>
                                      <TableCell>
                                        <GeneratedValue value={row.assignment.expiresOn ?? '—'} />
                                      </TableCell>
                                      <TableCell>
                                        <GeneratedValue
                                          value={
                                            row.status === 'expired' ? (
                                              <Badge variant="destructive">
                                                <GeneratedText id="m_13f7150c94b182" />{' '}
                                                {Math.abs(row.daysLeft!)}
                                                <GeneratedText id="m_0ced4968a01894" />
                                              </Badge>
                                            ) : row.status === 'expiring' ? (
                                              <Badge variant="warning">
                                                {row.daysLeft}
                                                <GeneratedText id="m_0a3d63460246cf" />
                                              </Badge>
                                            ) : row.status === 'ok' ? (
                                              <Badge variant="success">
                                                <GeneratedText id="m_1e418d0475450c" />
                                              </Badge>
                                            ) : (
                                              <Badge variant="secondary">
                                                <GeneratedText id="m_1bbc44c1ce26a7" />
                                              </Badge>
                                            )
                                          }
                                        />
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                />
                              </TableBody>
                            </Table>
                          )
                        }
                      />
                    </CardContent>
                  </Card>
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'ppe' ? (
                  <div className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          <GeneratedText id="m_00410f4adc7873" />
                          <GeneratedValue value={ppeAssigned.length} />)
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <GeneratedValue
                          value={
                            ppeAssigned.length === 0 ? (
                              <p className="text-sm text-slate-500">
                                <GeneratedText id="m_155a2629c588fd" />
                              </p>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>
                                      <GeneratedText id="m_074ba2f160c506" />
                                    </TableHead>
                                    <TableHead>
                                      <GeneratedText id="m_179218139b624a" />
                                    </TableHead>
                                    <TableHead>
                                      <GeneratedText id="m_11ad4bbeced31b" />
                                    </TableHead>
                                    <TableHead>
                                      <GeneratedText id="m_0b9da892d6faf0" />
                                    </TableHead>
                                    <TableHead></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  <GeneratedValue
                                    value={ppeAssigned.map((row) => (
                                      <TableRow key={row.item.id}>
                                        <TableCell className="font-medium">
                                          <GeneratedValue value={row.type.name} />
                                        </TableCell>
                                        <TableCell>
                                          <GeneratedValue value={row.item.serialNumber ?? '—'} />
                                        </TableCell>
                                        <TableCell>
                                          <GeneratedValue value={row.item.size ?? '—'} />
                                        </TableCell>
                                        <TableCell>
                                          <Badge variant="secondary">
                                            <GeneratedValue
                                              value={row.item.status.replace('_', ' ')}
                                            />
                                          </Badge>
                                        </TableCell>
                                        <TableCell>
                                          <Link
                                            href={`/ppe/${row.item.id}`}
                                            className="text-xs text-teal-700 hover:underline"
                                          >
                                            <GeneratedText id="m_1be345fc118df8" />
                                          </Link>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  />
                                </TableBody>
                              </Table>
                            )
                          }
                        />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          <GeneratedText id="m_0057e65a990510" />
                          <GeneratedValue value={ppeIssueLog.length} />)
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <GeneratedValue
                          value={
                            ppeIssueLog.length === 0 ? (
                              <p className="text-sm text-slate-500">
                                <GeneratedText id="m_0b73660bafdcc9" />
                              </p>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>
                                      <GeneratedText id="m_13cc128f69897c" />
                                    </TableHead>
                                    <TableHead>
                                      <GeneratedText id="m_0bad495a7046e9" />
                                    </TableHead>
                                    <TableHead>
                                      <GeneratedText id="m_074ba2f160c506" />
                                    </TableHead>
                                    <TableHead>
                                      <GeneratedText id="m_179218139b624a" />
                                    </TableHead>
                                    <TableHead>
                                      <GeneratedText id="m_16d241f76641bb" />
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  <GeneratedValue
                                    value={ppeIssueLog.map((row) => (
                                      <TableRow key={row.issue.id}>
                                        <TableCell>
                                          <GeneratedValue
                                            value={formatDate(
                                              new Date(row.issue.occurredAt),
                                              ctx.timezone,
                                              ctx.locale,
                                            )}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Badge variant="secondary">
                                            <GeneratedValue
                                              value={row.issue.action.replace('_', ' ')}
                                            />
                                          </Badge>
                                        </TableCell>
                                        <TableCell>
                                          <GeneratedValue value={row.type.name} />
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                          <GeneratedValue value={row.item.serialNumber ?? '—'} />
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-600">
                                          <GeneratedValue value={row.issue.note ?? '—'} />
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  />
                                </TableBody>
                              </Table>
                            )
                          }
                        />
                      </CardContent>
                    </Card>
                  </div>
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'documents' ? (
                  <div className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between text-base">
                          <span className="flex items-center gap-2">
                            <Paperclip size={16} />
                            <GeneratedText id="m_0247856c772e2c" />
                            <GeneratedValue value={fileRows.length} />)
                          </span>
                          <GeneratedValue
                            value={
                              canEditFiles ? (
                                <Link href={`${basePath}?tab=documents&drawer=upload-person-file`}>
                                  <Button size="sm">
                                    <GeneratedText id="m_06dc5804d9c769" />
                                  </Button>
                                </Link>
                              ) : null
                            }
                          />
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <GeneratedValue
                          value={
                            fileRows.length === 0 ? (
                              <EmptyState
                                icon={<Paperclip size={24} />}
                                title={tGenerated('m_1192d4035da0ad')}
                                description={tGenerated('m_10c0695d606c85')}
                              />
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>
                                      <GeneratedText id="m_1d088977412efb" />
                                    </TableHead>
                                    <TableHead>
                                      <GeneratedText id="m_1e578efe1574cd" />
                                    </TableHead>
                                    <TableHead>
                                      <GeneratedText id="m_0bd52c07efd4da" />
                                    </TableHead>
                                    <TableHead>
                                      <GeneratedText id="m_028e286aa7b299" />
                                    </TableHead>
                                    <TableHead></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  <GeneratedValue
                                    value={fileRows.map(({ file, attachment }) => (
                                      <TableRow key={file.id}>
                                        <TableCell className="font-medium">
                                          <GeneratedValue value={file.label} />
                                        </TableCell>
                                        <TableCell>
                                          <Badge variant="secondary">
                                            <GeneratedValue value={file.kind.replace('_', ' ')} />
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-600">
                                          <GeneratedValue
                                            value={
                                              attachment ? (
                                                <a
                                                  href={attachmentUrl(attachment.id)}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-teal-700 hover:underline"
                                                >
                                                  {attachment.filename}
                                                </a>
                                              ) : (
                                                <span className="text-slate-400">
                                                  <GeneratedText id="m_0d47513e440f05" />
                                                </span>
                                              )
                                            }
                                          />
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-600">
                                          <GeneratedValue
                                            value={formatDate(
                                              new Date(file.uploadedAt),
                                              ctx.timezone,
                                              ctx.locale,
                                            )}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <GeneratedValue
                                            value={
                                              canEditFiles ? (
                                                <form action={deletePersonFile} className="inline">
                                                  <input type="hidden" name="id" value={file.id} />
                                                  <input
                                                    type="hidden"
                                                    name="personId"
                                                    value={person.id}
                                                  />
                                                  <Button
                                                    type="submit"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-red-500 hover:text-red-700"
                                                    title={tGenerated('m_0c470a36b6b277')}
                                                  >
                                                    <Trash2 size={14} />
                                                  </Button>
                                                </form>
                                              ) : null
                                            }
                                          />
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  />
                                </TableBody>
                              </Table>
                            )
                          }
                        />
                      </CardContent>
                    </Card>
                  </div>
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'incidents' ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <GeneratedText id="m_0017d89362992e" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <GeneratedValue
                        value={
                          allIncidents.length === 0 ? (
                            <EmptyState
                              icon={<HardHat size={24} />}
                              title={tGenerated('m_00c432de87ecf5')}
                            />
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>
                                    <GeneratedText id="m_036b564bb88dfe" />
                                  </TableHead>
                                  <TableHead>
                                    <GeneratedText id="m_14a5e97535a15a" />
                                  </TableHead>
                                  <TableHead>
                                    <GeneratedText id="m_0decefd558c355" />
                                  </TableHead>
                                  <TableHead>
                                    <GeneratedText id="m_1099c1fe8b6614" />
                                  </TableHead>
                                  <TableHead>
                                    <GeneratedText id="m_0b9da892d6faf0" />
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                <GeneratedValue
                                  value={allIncidents.map(({ incident, injured }) => (
                                    <TableRow key={incident.id}>
                                      <TableCell className="font-mono text-xs">
                                        <Link
                                          href={`/incidents/${incident.id}`}
                                          className="hover:underline"
                                        >
                                          <GeneratedValue value={incident.reference} />
                                        </Link>
                                      </TableCell>
                                      <TableCell>
                                        <GeneratedValue
                                          value={formatDate(
                                            new Date(incident.occurredAt),
                                            ctx.timezone,
                                            ctx.locale,
                                          )}
                                        />
                                      </TableCell>
                                      <TableCell>
                                        <GeneratedValue value={incident.title} />
                                      </TableCell>
                                      <TableCell>
                                        <Badge variant={injured ? 'destructive' : 'secondary'}>
                                          <GeneratedValue
                                            value={
                                              injured ? (
                                                <GeneratedText id="m_07b3d718b13c62" />
                                              ) : (
                                                <GeneratedText id="m_0bf0175836c8c5" />
                                              )
                                            }
                                          />
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-slate-600">
                                        <GeneratedValue
                                          value={incident.status.replace(/_/g, ' ')}
                                        />
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                />
                              </TableBody>
                            </Table>
                          )
                        }
                      />
                    </CardContent>
                  </Card>
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'activity' ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <GeneratedText id="m_14b78af1b2f95e" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ActivityFeed
                        entries={activity}
                        timeZone={ctx.timezone}
                        locale={ctx.locale}
                      />
                    </CardContent>
                  </Card>
                ) : null
              }
            />
          </div>
        </div>
      </div>
      <GeneratedValue
        value={
          canEditFiles ? (
            <PersonFilesDrawers
              personId={person.id}
              openDrawer={openDrawer === 'upload-person-file' ? openDrawer : null}
              closeHref={basePathForDrawer}
            />
          ) : null
        }
      />
    </PageContainer>
  )
}

function SidebarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-xs tracking-wide text-slate-500 uppercase">
        <GeneratedValue value={label} />
      </span>
      <span>
        <GeneratedValue value={children} />
      </span>
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
      <span className={`text-lg font-semibold tabular-nums ${colour}`}>
        <GeneratedValue value={value} />
      </span>
      <span className="text-xs text-slate-500 dark:text-slate-400">
        <GeneratedValue value={label} />
      </span>
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
  const tGenerated = useGeneratedTranslations()
  const trainingPct = trainingTotal === 0 ? null : Math.round((trainingValid / trainingTotal) * 100)
  const overdueCount = trainingExpired
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <BigStatCard
        icon={<BadgeCheck size={20} />}
        title={tGenerated('m_05cbc2207cd76c')}
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
        title={tGenerated('m_014da4244c7d2c')}
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
        title={tGenerated('m_0c7fac0190c234')}
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
        title={tGenerated('m_13c83c2c950fa2')}
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
        title={tGenerated('m_080a08e25fba42')}
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
          <span className={colour}>
            <GeneratedValue value={icon} />
          </span>
          <GeneratedValue value={title} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-4xl font-semibold tabular-nums ${colour}`}>
          <GeneratedValue value={primary} />
        </div>
        <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
          <GeneratedValue
            value={detail.map((d, i) => (
              <li key={i}>
                <GeneratedValue value={d} />
              </li>
            ))}
          />
        </ul>
      </CardContent>
    </Card>
  )
}
