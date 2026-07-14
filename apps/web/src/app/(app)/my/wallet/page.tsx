// "My wallet" — an Apple-Wallet-style view of the signed-in user's credentials.
//
// Every training record and granted skill is rendered through the SAME design
// system that produces the printed CR80 cards: the tenant's configured *wallet*
// credential design document (resolveCredentialOutput → format 'wallet'), drawn
// to HTML by `renderDesignDocumentHtml`. The front/back artboards on screen are
// therefore pixel-identical to the downloaded PDF. Each card links to its
// print-ready pass and, once a verification certificate exists, shows a
// scan-to-verify QR.
//
// Pivots on people.userId = ctx.userId, like every other /my view.

import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import QRCode from 'qrcode'
import { PageHeader } from '@beaconhs/ui'
import {
  attachments,
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
import { attachmentUrl } from '@/lib/attachment-url'
import {
  createWalletDesignDocument,
  renderDesignDocumentHtml,
  type CredentialDesignData,
} from '@beaconhs/design-studio'
import { requireRequestContext } from '@/lib/auth'
import { appBaseUrl } from '@/lib/app-base-url'
import { latestTrainingRecordOnly } from '@/lib/training-latest'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'
import { resolveCourseCredentialOutput, resolveCredentialOutput } from '@/lib/credential-designs'
import { WorkspaceNoIdentity } from '../_no-identity'
import { WalletStack, type WalletCard, type WalletDesign } from './_wallet-stack'

export const metadata = { title: 'My wallet' }
export const dynamic = 'force-dynamic'

const EXPIRING_DAYS = 60
const SORTS = ['urgency'] as const
const KIND_OPTIONS = [
  { value: 'training', label: 'Training' },
  { value: 'skill', label: 'Skills' },
] as const
const STATUS_OPTIONS = [
  { value: 'valid', label: 'Valid' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
  { value: 'none', label: 'No expiry' },
] as const

type CredentialIndexRow = {
  kind: 'training' | 'skill'
  id: string
  status: WalletCard['status']
}

function statusFor(expiresOn: string | null, todayStr: string): WalletCard['status'] {
  if (!expiresOn) return 'none'
  if (expiresOn < todayStr) return 'expired'
  const soon = new Date()
  soon.setDate(soon.getDate() + EXPIRING_DAYS)
  if (expiresOn <= soon.toISOString().slice(0, 10)) return 'expiring'
  return 'valid'
}

export default async function MyWalletPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const listParams = parseListParams(sp, {
    sort: 'urgency',
    dir: 'asc',
    perPage: 12,
    allowedSorts: SORTS,
  })
  const requestedKind = pickString(sp.kind)
  const kind = requestedKind === 'training' || requestedKind === 'skill' ? requestedKind : undefined
  const requestedStatus = pickString(sp.status)
  const status =
    requestedStatus === 'valid' ||
    requestedStatus === 'expiring' ||
    requestedStatus === 'expired' ||
    requestedStatus === 'none'
      ? requestedStatus
      : undefined
  const ctx = await requireRequestContext()
  const todayStr = new Date().toISOString().slice(0, 10)
  const expiringThrough = new Date()
  expiringThrough.setDate(expiringThrough.getDate() + EXPIRING_DAYS)
  const expiringThroughStr = expiringThrough.toISOString().slice(0, 10)

  const data = await ctx.db(async (tx) => {
    const [person] = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
        photoAttachmentId: people.photoAttachmentId,
      })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
      .limit(1)
    if (!person) return { person: null } as const

    const [tenant] = await tx
      .select({ name: tenants.name, branding: tenants.branding, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1)

    const credentialSet = sql`
      select 'training'::text as kind,
        ${trainingRecords.id}::text as id,
        coalesce(${trainingCourses.name}, 'Training credential')::text as title,
        ${trainingCourses.code}::text as code,
        null::text as authority_name,
        ${trainingRecords.completedOn}::date as issued_on,
        ${trainingRecords.expiresOn}::date as expires_on,
        case
          when ${trainingRecords.expiresOn} is null then 'none'
          when ${trainingRecords.expiresOn} < ${todayStr}::date then 'expired'
          when ${trainingRecords.expiresOn} <= ${expiringThroughStr}::date then 'expiring'
          else 'valid'
        end::text as status
      from ${trainingRecords}
      left join ${trainingCourses} on ${trainingCourses.id} = ${trainingRecords.courseId}
      where ${trainingRecords.personId} = ${person.id}
        and ${trainingRecords.deletedAt} is null
        and ${latestTrainingRecordOnly()}

      union all

      select 'skill'::text as kind,
        ${trainingSkillAssignments.id}::text as id,
        ${trainingSkillTypes.name}::text as title,
        ${trainingSkillTypes.code}::text as code,
        ${trainingSkillAuthorities.name}::text as authority_name,
        ${trainingSkillAssignments.grantedOn}::date as issued_on,
        ${trainingSkillAssignments.expiresOn}::date as expires_on,
        case
          when ${trainingSkillAssignments.expiresOn} is null then 'none'
          when ${trainingSkillAssignments.expiresOn} < ${todayStr}::date then 'expired'
          when ${trainingSkillAssignments.expiresOn} <= ${expiringThroughStr}::date then 'expiring'
          else 'valid'
        end::text as status
      from ${trainingSkillAssignments}
      inner join ${trainingSkillTypes}
        on ${trainingSkillTypes.id} = ${trainingSkillAssignments.skillTypeId}
      left join ${trainingSkillAuthorities}
        on ${trainingSkillAuthorities.id} = ${trainingSkillTypes.authorityId}
      where ${trainingSkillAssignments.personId} = ${person.id}
        and ${trainingSkillAssignments.deletedAt} is null
    `
    const filters: SQL[] = []
    if (listParams.q) {
      const term = `%${listParams.q}%`
      filters.push(sql`(title ilike ${term} or code ilike ${term} or authority_name ilike ${term})`)
    }
    if (kind) filters.push(sql`kind = ${kind}`)
    if (status) filters.push(sql`status = ${status}`)
    const where = filters.length > 0 ? sql`where ${sql.join(filters, sql` and `)}` : sql``
    const [indexResult, countResult] = await Promise.all([
      tx.execute<CredentialIndexRow>(sql`
        with credentials as (${credentialSet})
        select kind, id, status from credentials
        ${where}
        order by case status
          when 'expired' then 0
          when 'expiring' then 1
          when 'valid' then 2
          else 3
        end, kind asc, issued_on desc, title asc, id asc
        limit ${listParams.perPage}
        offset ${(listParams.page - 1) * listParams.perPage}
      `),
      tx.execute<{ total: number | string }>(sql`
        with credentials as (${credentialSet})
        select count(*)::int as total from credentials ${where}
      `),
    ])
    const credentialIndex = indexResult as unknown as CredentialIndexRow[]
    const credentialCountRows = countResult as unknown as Array<{ total: number | string }>
    const recordIds = credentialIndex
      .filter((item) => item.kind === 'training')
      .map((item) => item.id)
    const skillIds = credentialIndex.filter((item) => item.kind === 'skill').map((item) => item.id)

    const [records, skills] = await Promise.all([
      recordIds.length
        ? tx
            .select({
              id: trainingRecords.id,
              completedOn: trainingRecords.completedOn,
              expiresOn: trainingRecords.expiresOn,
              instructor: trainingRecords.instructor,
              grade: trainingRecords.grade,
              courseName: trainingCourses.name,
              courseCode: trainingCourses.code,
              courseMetadata: trainingCourses.metadata,
            })
            .from(trainingRecords)
            .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
            .where(inArray(trainingRecords.id, recordIds))
        : Promise.resolve([]),
      skillIds.length
        ? tx
            .select({
              id: trainingSkillAssignments.id,
              grantedOn: trainingSkillAssignments.grantedOn,
              expiresOn: trainingSkillAssignments.expiresOn,
              skillName: trainingSkillTypes.name,
              skillCode: trainingSkillTypes.code,
              authorityName: trainingSkillAuthorities.name,
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
            .where(inArray(trainingSkillAssignments.id, skillIds))
        : Promise.resolve([]),
    ])

    // Existing verification tokens (we never issue on render — the download
    // route lazily creates them). Cards with a token get a scan-to-verify QR.
    const recordCerts = records.length
      ? await tx
          .select({
            recordId: trainingCertificates.recordId,
            token: trainingCertificates.verifyToken,
          })
          .from(trainingCertificates)
          .where(
            and(
              isNull(trainingCertificates.revokedAt),
              inArray(
                trainingCertificates.recordId,
                records.map((r) => r.id),
              ),
            ),
          )
      : []
    const skillCerts = skills.length
      ? await tx
          .select({
            assignmentId: trainingSkillCertificates.skillAssignmentId,
            token: trainingSkillCertificates.verifyToken,
          })
          .from(trainingSkillCertificates)
          .where(
            and(
              isNull(trainingSkillCertificates.revokedAt),
              inArray(
                trainingSkillCertificates.skillAssignmentId,
                skills.map((s) => s.id),
              ),
            ),
          )
      : []

    let photoUrl: string | null = null
    if (person.photoAttachmentId) {
      const [photo] = await tx
        .select({ r2Key: attachments.r2Key })
        .from(attachments)
        .where(eq(attachments.id, person.photoAttachmentId))
        .limit(1)
      photoUrl = photo ? attachmentUrl(person.photoAttachmentId) : null
    }

    return {
      person,
      tenant,
      credentialIndex,
      credentialTotal: Number(credentialCountRows[0]?.total ?? 0),
      records,
      skills,
      recordCerts,
      skillCerts,
      photoUrl,
    } as const
  })

  if (!data.person) {
    return (
      <ListPageLayout
        header={
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title="My wallet"
            description="Your certificates and credential cards."
          />
        }
      >
        <WorkspaceNoIdentity
          reason={ctx.membership ? 'no-person' : 'no-membership'}
          noun="credentials"
        />
      </ListPageLayout>
    )
  }

  const {
    person,
    tenant,
    credentialIndex,
    credentialTotal,
    records,
    skills,
    recordCerts,
    skillCerts,
    photoUrl,
  } = data
  // Tenant-default wallet design — used for skills and as the fallback. Training
  // records resolve their own design from the course's pinned selection below.
  const defaultOutput = resolveCredentialOutput(tenant?.settings, { format: 'wallet' })
  const defaultDocument = defaultOutput.document ?? createWalletDesignDocument(defaultOutput)
  const front = defaultDocument.artboards[0]
  const widthIn = front?.width ?? 3.375
  const heightIn = front?.height ?? 2.125

  const base = appBaseUrl()
  const tenantName = tenant?.name ?? 'Credential'
  const tenantLogoUrl = tenant?.branding?.logoUrl ?? null
  const recipientFullName = `${person.firstName} ${person.lastName}`

  const tokenByRecord = new Map(recordCerts.map((c) => [c.recordId, c.token]))
  const tokenByAssignment = new Map(skillCerts.map((c) => [c.assignmentId, c.token]))

  async function qrFor(token: string | undefined): Promise<string | null> {
    if (!token) return null
    return QRCode.toDataURL(`${base}/verify/${token}`, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
  }

  async function renderCard(
    doc: typeof defaultDocument,
    cardData: CredentialDesignData,
  ): Promise<{ frontHtml: string; backHtml: string }> {
    const fId = doc.artboards[0]?.id ?? null
    const bId = doc.artboards[1]?.id ?? fId
    const frontHtml = renderDesignDocumentHtml(doc, cardData, { artboardId: fId })
    const backHtml = renderDesignDocumentHtml(doc, cardData, { artboardId: bId })
    return { frontHtml, backHtml }
  }

  const trainingCards: WalletCard[] = await Promise.all(
    records.map(async (r) => {
      const token = tokenByRecord.get(r.id)
      const qrDataUrl = await qrFor(token)
      // Each course can pin its own wallet design; fall back to the tenant default.
      const recordOutput = resolveCourseCredentialOutput(r.courseMetadata, tenant?.settings, {
        format: 'wallet',
      })
      const recordDocument = recordOutput.document ?? createWalletDesignDocument(recordOutput)
      const faces = await renderCard(recordDocument, {
        tenantName,
        tenantLogoUrl,
        recipientFullName,
        recipientEmployeeNo: person.employeeNo,
        recipientPhotoUrl: photoUrl,
        credentialName: r.courseName ?? 'Training credential',
        credentialCode: r.courseCode ?? null,
        completedOn: r.completedOn,
        expiresOn: r.expiresOn,
        instructor: r.instructor,
        grade: r.grade,
        verifyUrl: token ? `${base}/verify/${token}` : null,
        verifyToken: token ?? null,
        qrDataUrl,
      })
      return {
        id: `t-${r.id}`,
        kind: 'training' as const,
        title: r.courseName ?? 'Training credential',
        status: statusFor(r.expiresOn, todayStr),
        pdfHref: `/training/records/${r.id}/certificate?output=${recordOutput.id}`,
        verifyHref: token ? `/verify/${token}` : null,
        ...faces,
      }
    }),
  )

  const skillCards: WalletCard[] = await Promise.all(
    skills.map(async (s) => {
      const token = tokenByAssignment.get(s.id)
      const qrDataUrl = await qrFor(token)
      const faces = await renderCard(defaultDocument, {
        tenantName,
        tenantLogoUrl,
        recipientFullName,
        recipientEmployeeNo: person.employeeNo,
        recipientPhotoUrl: photoUrl,
        credentialName: s.skillName,
        credentialCode: s.skillCode ?? null,
        authorityName: s.authorityName,
        completedOn: s.grantedOn,
        expiresOn: s.expiresOn,
        verifyUrl: token ? `${base}/verify/${token}` : null,
        verifyToken: token ?? null,
        qrDataUrl,
      })
      return {
        id: `s-${s.id}`,
        kind: 'skill' as const,
        title: s.skillName,
        status: statusFor(s.expiresOn, todayStr),
        pdfHref: `/training/skills/${s.id}/certificate?output=${defaultOutput.id}`,
        verifyHref: token ? `/verify/${token}` : null,
        ...faces,
      }
    }),
  )

  const cardByKey = new Map(
    [...trainingCards, ...skillCards].map((card) => [`${card.kind}:${card.id.slice(2)}`, card]),
  )
  const cards = credentialIndex
    .map((item) => cardByKey.get(`${item.kind}:${item.id}`))
    .filter((card): card is WalletCard => Boolean(card))

  const design: WalletDesign = { widthIn, heightIn }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title="My wallet"
            description="Your certificates and credential cards. Tap a card to flip it, or download the print-ready pass."
          />
          <TableToolbar>
            <SearchInput placeholder="Search credentials…" />
            <FilterChips
              basePath="/my/wallet"
              currentParams={sp}
              paramKey="kind"
              label="Type"
              options={[...KIND_OPTIONS]}
            />
            <FilterChips
              basePath="/my/wallet"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={[...STATUS_OPTIONS]}
            />
          </TableToolbar>
        </>
      }
    >
      <>
        {cards.length === 0 ? (
          <WalletStack
            cards={cards}
            design={design}
            filtered={Boolean(listParams.q || kind || status)}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="p-4">
              <WalletStack cards={cards} design={design} />
            </div>
          </div>
        )}
        {credentialTotal > 0 ? (
          <Pagination
            basePath="/my/wallet"
            currentParams={sp}
            total={credentialTotal}
            page={listParams.page}
            perPage={listParams.perPage}
          />
        ) : null}
      </>
    </ListPageLayout>
  )
}
