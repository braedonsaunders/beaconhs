import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { alias } from 'drizzle-orm/pg-core'
import {
  AlertTriangle,
  Folder,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
  Truck,
  Users,
} from 'lucide-react'
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
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
  customerContacts,
  equipmentItems,
  equipmentTypes,
  incidents,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import type { AppLocale } from '@beaconhs/i18n'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { moduleScopeWhere } from '@/lib/visibility'
import { recentActivityForEntity } from '@/lib/audit'
import { getTenantHierarchy, levelLabel, type TenantHierarchy } from '@/lib/org-hierarchy'
import { ActivityFeed } from '@/components/activity-feed'
import { LiveField } from '@/components/live-field'
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section'
import { DetailPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { Section } from '@/components/section'
import { TableToolbar } from '@/components/table-toolbar'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import {
  archiveLocation,
  createContactFromDrawer,
  createProject,
  deleteContact,
  restoreLocation,
  updateContactFromDrawer,
  updateLocationField,
} from '../_actions/locations'
import { ContactDrawer, type ContactRow } from './_drawers'

export const dynamic = 'force-dynamic'

const CUSTOMER_TABS = [
  'overview',
  'projects',
  'sites',
  'contacts',
  'incidents',
  'equipment',
  'activity',
] as const
const PROJECT_TABS = [
  'overview',
  'sites',
  'contacts',
  'incidents',
  'equipment',
  'activity',
] as const
const SITE_TABS = ['overview', 'contacts', 'incidents', 'equipment', 'activity'] as const

type CustomerTab = (typeof CUSTOMER_TABS)[number]
type ProjectTab = (typeof PROJECT_TABS)[number]
type SiteTab = (typeof SITE_TABS)[number]
type LocationListParams = ReturnType<typeof parseListParams<'name'>>

const LOCATION_LIST_KEYS = {
  overview: {
    q: 'overviewQ',
    sort: 'overviewSort',
    dir: 'overviewDir',
    page: 'overviewPage',
    perPage: 'overviewPerPage',
    filter: 'overviewFilter',
  },
  projects: {
    q: 'projectQ',
    sort: 'projectSort',
    dir: 'projectDir',
    page: 'projectPage',
    perPage: 'projectPerPage',
    filter: 'projectFilter',
  },
  sites: {
    q: 'siteQ',
    sort: 'siteSort',
    dir: 'siteDir',
    page: 'sitePage',
    perPage: 'sitePerPage',
    filter: 'siteFilter',
  },
  contacts: {
    q: 'contactQ',
    sort: 'contactSort',
    dir: 'contactDir',
    page: 'contactPage',
    perPage: 'contactPerPage',
    filter: 'contactFilter',
  },
  incidents: {
    q: 'incidentQ',
    sort: 'incidentSort',
    dir: 'incidentDir',
    page: 'incidentPage',
    perPage: 'incidentPerPage',
    filter: 'incidentStatus',
  },
  equipment: {
    q: 'equipmentQ',
    sort: 'equipmentSort',
    dir: 'equipmentDir',
    page: 'equipmentPage',
    perPage: 'equipmentPerPage',
    filter: 'equipmentStatus',
  },
  activity: {
    q: 'activityQ',
    sort: 'activitySort',
    dir: 'activityDir',
    page: 'activityPage',
    perPage: 'activityPerPage',
    filter: 'activityFilter',
  },
} as const

type LocationTab = keyof typeof LOCATION_LIST_KEYS
type LocationListKeys = (typeof LOCATION_LIST_KEYS)[LocationTab]

function listKeysForLocationTab(value: string | undefined): LocationListKeys {
  return value && value in LOCATION_LIST_KEYS
    ? LOCATION_LIST_KEYS[value as LocationTab]
    : LOCATION_LIST_KEYS.overview
}

const LIST_SORTS = ['name'] as const
const INCIDENT_STATUSES = [
  { value: 'reported', label: 'Reported' },
  { value: 'under_investigation', label: 'Under investigation' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'closed', label: 'Closed' },
  { value: 'reopened', label: 'Reopened' },
] as const
const EQUIPMENT_STATUSES = [
  { value: 'in_service', label: 'In service' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'lost', label: 'Lost' },
  { value: 'retired', label: 'Retired' },
] as const

function incidentStatusFrom(value: string | undefined) {
  return INCIDENT_STATUSES.find((option) => option.value === value)?.value
}

function equipmentStatusFrom(value: string | undefined) {
  return EQUIPMENT_STATUSES.find((option) => option.value === value)?.value
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_0c497d50eed230', { value0: id.slice(0, 8) }) }
}

// -------------------- Helpers --------------------

/** Resolve the full descendant org-unit id set for a given root, walking the tree. */
async function resolveDescendantIds(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  rootId: string,
): Promise<string[]> {
  return ctx.db(async (tx) => {
    const result = new Set<string>([rootId])
    let frontier = [rootId]
    // Loop a bounded number of times to be safe.
    for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
      const children = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(inArray(orgUnits.parentId, frontier))
      const ids = children.map((c) => c.id)
      const next: string[] = []
      for (const id of ids) {
        if (!result.has(id)) {
          result.add(id)
          next.push(id)
        }
      }
      frontier = next
    }
    return Array.from(result)
  })
}

async function loadIncidentsForUnits(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  orgUnitIds: string[],
  params: LocationListParams,
  status: 'reported' | 'under_investigation' | 'pending_review' | 'closed' | 'reopened' | undefined,
  includeRows: boolean,
) {
  if (orgUnitIds.length === 0) return { rows: [], total: 0, filteredTotal: 0 }
  return ctx.db(async (tx) => {
    // Honor the viewer's incidents read tier — the same predicate the
    // /incidents list applies, so this tab can't be used to enumerate
    // incidents the viewer couldn't otherwise see.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'incidents',
      ownerCols: [incidents.reportedByTenantUserId],
      siteCol: incidents.siteOrgUnitId,
    })
    const base = and(inArray(incidents.siteOrgUnitId, orgUnitIds), isNull(incidents.deletedAt), vis)
    const search = params.q
      ? or(
          ilike(incidents.reference, `%${params.q}%`),
          ilike(incidents.title, `%${params.q}%`),
          ilike(incidents.description, `%${params.q}%`),
        )
      : undefined
    const filtered = and(base, search, status ? eq(incidents.status, status) : undefined)
    const [[totalRow], [filteredRow], rows] = await Promise.all([
      tx.select({ c: count() }).from(incidents).where(base),
      includeRows ? tx.select({ c: count() }).from(incidents).where(filtered) : Promise.resolve([]),
      includeRows
        ? tx
            .select()
            .from(incidents)
            .where(filtered)
            .orderBy(desc(incidents.occurredAt), desc(incidents.id))
            .limit(params.perPage)
            .offset((params.page - 1) * params.perPage)
        : Promise.resolve([]),
    ])
    return {
      rows,
      total: Number(totalRow?.c ?? 0),
      filteredTotal: Number(filteredRow?.c ?? 0),
    }
  })
}

async function loadEquipmentForUnits(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  orgUnitIds: string[],
  params: LocationListParams,
  status: 'in_service' | 'out_of_service' | 'in_repair' | 'lost' | 'retired' | undefined,
  includeRows: boolean,
) {
  if (orgUnitIds.length === 0) return { rows: [], total: 0, filteredTotal: 0 }
  return ctx.db(async (tx) => {
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    const base = and(
      inArray(equipmentItems.currentSiteOrgUnitId, orgUnitIds),
      isNull(equipmentItems.deletedAt),
      vis,
    )
    const search = params.q
      ? or(
          ilike(equipmentItems.name, `%${params.q}%`),
          ilike(equipmentItems.assetTag, `%${params.q}%`),
          ilike(equipmentTypes.name, `%${params.q}%`),
          ilike(people.firstName, `%${params.q}%`),
          ilike(people.lastName, `%${params.q}%`),
        )
      : undefined
    const filtered = and(base, search, status ? eq(equipmentItems.status, status) : undefined)
    const [[totalRow], [filteredRow], rows] = await Promise.all([
      tx.select({ c: count() }).from(equipmentItems).where(base),
      includeRows
        ? tx
            .select({ c: count() })
            .from(equipmentItems)
            .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
            .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
            .where(filtered)
        : Promise.resolve([]),
      includeRows
        ? tx
            .select({ item: equipmentItems, type: equipmentTypes, holder: people })
            .from(equipmentItems)
            .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
            .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
            .where(filtered)
            .orderBy(asc(equipmentItems.name), asc(equipmentItems.id))
            .limit(params.perPage)
            .offset((params.page - 1) * params.perPage)
        : Promise.resolve([]),
    ])
    return {
      rows,
      total: Number(totalRow?.c ?? 0),
      filteredTotal: Number(filteredRow?.c ?? 0),
    }
  })
}

async function loadContactsForUnit(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  orgUnitId: string,
  params: LocationListParams,
  includeRows: boolean,
  editContactId: string | null,
) {
  return ctx.db(async (tx) => {
    const base = eq(customerContacts.orgUnitId, orgUnitId)
    const search = params.q
      ? or(
          ilike(customerContacts.name, `%${params.q}%`),
          ilike(customerContacts.role, `%${params.q}%`),
          ilike(customerContacts.email, `%${params.q}%`),
          ilike(customerContacts.phone, `%${params.q}%`),
        )
      : undefined
    const filtered = and(base, search)
    const [[totalRow], [filteredRow], rows, editRows] = await Promise.all([
      tx.select({ c: count() }).from(customerContacts).where(base),
      includeRows
        ? tx.select({ c: count() }).from(customerContacts).where(filtered)
        : Promise.resolve([]),
      includeRows
        ? tx
            .select()
            .from(customerContacts)
            .where(filtered)
            .orderBy(asc(customerContacts.name), asc(customerContacts.id))
            .limit(params.perPage)
            .offset((params.page - 1) * params.perPage)
        : Promise.resolve([]),
      editContactId
        ? tx
            .select()
            .from(customerContacts)
            .where(and(base, eq(customerContacts.id, editContactId)))
            .limit(1)
        : Promise.resolve([]),
    ])
    return {
      rows,
      total: Number(totalRow?.c ?? 0),
      filteredTotal: Number(filteredRow?.c ?? 0),
      editing: editRows[0] ?? null,
    }
  })
}

// -------------------- Page entry --------------------

export default async function LocationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const listKeys = listKeysForLocationTab(pickString(sp.tab))
  const listParams = parseListParams(
    {
      q: sp[listKeys.q],
      sort: sp[listKeys.sort],
      dir: sp[listKeys.dir],
      page: sp[listKeys.page],
      perPage: sp[listKeys.perPage],
    },
    {
      sort: 'name',
      dir: 'asc',
      perPage: 25,
      allowedSorts: LIST_SORTS,
    },
  )
  const drawer = typeof sp.drawer === 'string' ? sp.drawer : null
  const requestedContactId = typeof sp.contactId === 'string' ? sp.contactId : null
  const editContactId =
    drawer === 'edit-contact' && requestedContactId && isUuid(requestedContactId)
      ? requestedContactId
      : null
  const ctx = await requireRequestContext()
  const hierarchy = await getTenantHierarchy(ctx.tenantId)
  // Read-only unless the viewer can manage the org tree. The autosave / write
  // actions re-assert this server-side; this only gates the inputs and
  // affordances.
  const canManage = can(ctx, 'admin.org.manage') || ctx.isSuperAdmin

  const data = await ctx.db(async (tx) => {
    const [unit] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    if (!unit) return null

    const [parent] = unit.parentId
      ? await tx.select().from(orgUnits).where(eq(orgUnits.id, unit.parentId)).limit(1)
      : [null]

    return { unit, parent }
  })

  if (!data) notFound()
  const { unit, parent } = data

  if (unit.level === 'customer') {
    return renderCustomer({
      unit,
      sp,
      listParams,
      drawer,
      editContactId,
      id,
      ctx,
      hierarchy,
      canManage,
    })
  }
  if (unit.level === 'project') {
    return renderProject({
      unit,
      parent,
      sp,
      listParams,
      drawer,
      editContactId,
      id,
      ctx,
      hierarchy,
      canManage,
    })
  }
  return renderSite({
    unit,
    parent,
    sp,
    listParams,
    drawer,
    editContactId,
    id,
    ctx,
    canManage,
  })
}

// -------------------- Customer view --------------------

async function renderCustomer({
  unit,
  sp,
  listParams,
  drawer,
  editContactId,
  id,
  ctx,
  hierarchy,
  canManage,
}: {
  unit: typeof orgUnits.$inferSelect
  sp: Record<string, string | string[] | undefined>
  listParams: LocationListParams
  drawer: string | null
  editContactId: string | null
  id: string
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
  hierarchy: TenantHierarchy
  canManage: boolean
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  // Drop levels this tenant has switched off so a disabled depth can't be
  // reached even via a hand-edited ?tab= URL.
  const visibleTabs = CUSTOMER_TABS.filter(
    (t) => (t !== 'projects' || hierarchy.project) && (t !== 'sites' || hierarchy.site),
  )
  const active: CustomerTab = pickActiveTab(sp, visibleTabs, 'overview')
  const listKeys = LOCATION_LIST_KEYS[active]
  const basePath = `/locations/${id}`
  const siteParent = alias(orgUnits, 'site_parent')
  const [orgData, contactData, descendantIds] = await Promise.all([
    ctx.db(async (tx) => {
      const projectBase = and(eq(orgUnits.parentId, id), eq(orgUnits.level, 'project'))
      const projectSearch = listParams.q
        ? or(ilike(orgUnits.name, `%${listParams.q}%`), ilike(orgUnits.code, `%${listParams.q}%`))
        : undefined
      const projectWhere = and(projectBase, projectSearch)
      const siteBase = and(
        eq(orgUnits.level, 'site'),
        or(eq(orgUnits.parentId, id), eq(siteParent.parentId, id)),
      )
      const siteSearch = listParams.q
        ? or(
            ilike(orgUnits.name, `%${listParams.q}%`),
            ilike(orgUnits.code, `%${listParams.q}%`),
            ilike(siteParent.name, `%${listParams.q}%`),
          )
        : undefined
      const siteWhere = and(siteBase, siteSearch)
      const [
        [projectCountRow],
        [siteCountRow],
        [filteredProjectRow],
        [filteredSiteRow],
        projects,
        sites,
      ] = await Promise.all([
        tx.select({ c: count() }).from(orgUnits).where(projectBase),
        tx
          .select({ c: count() })
          .from(orgUnits)
          .leftJoin(siteParent, eq(siteParent.id, orgUnits.parentId))
          .where(siteBase),
        active === 'projects'
          ? tx.select({ c: count() }).from(orgUnits).where(projectWhere)
          : Promise.resolve([]),
        active === 'sites'
          ? tx
              .select({ c: count() })
              .from(orgUnits)
              .leftJoin(siteParent, eq(siteParent.id, orgUnits.parentId))
              .where(siteWhere)
          : Promise.resolve([]),
        active === 'projects'
          ? tx
              .select()
              .from(orgUnits)
              .where(projectWhere)
              .orderBy(
                asc(sql`${orgUnits.deletedAt} is not null`),
                asc(orgUnits.name),
                asc(orgUnits.id),
              )
              .limit(listParams.perPage)
              .offset((listParams.page - 1) * listParams.perPage)
          : Promise.resolve([]),
        active === 'sites'
          ? tx
              .select({ unit: orgUnits, parentName: siteParent.name })
              .from(orgUnits)
              .leftJoin(siteParent, eq(siteParent.id, orgUnits.parentId))
              .where(siteWhere)
              .orderBy(asc(orgUnits.name), asc(orgUnits.id))
              .limit(listParams.perPage)
              .offset((listParams.page - 1) * listParams.perPage)
          : Promise.resolve([]),
      ])
      return {
        projects,
        projectCount: Number(projectCountRow?.c ?? 0),
        filteredProjectCount: Number(filteredProjectRow?.c ?? 0),
        sites,
        siteCount: Number(siteCountRow?.c ?? 0),
        filteredSiteCount: Number(filteredSiteRow?.c ?? 0),
      }
    }),
    loadContactsForUnit(ctx, id, listParams, active === 'contacts', editContactId),
    resolveDescendantIds(ctx, id),
  ])
  const incidentStatus =
    active === 'incidents' ? incidentStatusFrom(pickString(sp[listKeys.filter])) : undefined
  const equipmentStatus =
    active === 'equipment' ? equipmentStatusFrom(pickString(sp[listKeys.filter])) : undefined
  const [incidentData, equipmentData] = await Promise.all([
    loadIncidentsForUnits(ctx, descendantIds, listParams, incidentStatus, active === 'incidents'),
    loadEquipmentForUnits(ctx, descendantIds, listParams, equipmentStatus, active === 'equipment'),
  ])

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'org_unit', id, 25) : []

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/locations', label: 'Back to locations' }}
          title={tGeneratedValue(unit.name)}
          subtitle={tGeneratedValue(
            unit.code ? `${levelLabel('customer')} · ${unit.code}` : levelLabel('customer'),
          )}
          badge={
            <>
              <Badge variant="secondary">
                <GeneratedValue value={levelLabel('customer')} />
              </Badge>
              <GeneratedValue
                value={
                  unit.deletedAt ? (
                    <Badge variant="warning">
                      <GeneratedText id="m_12a687134482ba" />
                    </Badge>
                  ) : null
                }
              />
            </>
          }
          actions={
            canManage ? (
              unit.deletedAt ? (
                <form action={restoreLocation}>
                  <input type="hidden" name="id" value={unit.id} />
                  <Button type="submit" variant="outline" size="sm">
                    <GeneratedText id="m_19500e41842c99" />
                  </Button>
                </form>
              ) : (
                <form action={archiveLocation}>
                  <input type="hidden" name="id" value={unit.id} />
                  <Button type="submit" variant="outline" size="sm">
                    <GeneratedText id="m_019c0a64030688" />
                  </Button>
                </form>
              )
            ) : undefined
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          variant="pills"
          tabs={[
            { key: 'overview', label: 'Overview' },
            {
              key: 'projects',
              label: 'Projects',
              count: orgData.projectCount,
              hidden: !hierarchy.project,
            },
            { key: 'sites', label: 'Sites', count: orgData.siteCount, hidden: !hierarchy.site },
            { key: 'contacts', label: 'Contacts', count: contactData.total },
            { key: 'incidents', label: 'Incidents', count: incidentData.total },
            { key: 'equipment', label: 'Equipment', count: equipmentData.total },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      <GeneratedValue
        value={
          active === 'overview' ? <OverviewTab unit={unit} canManage={canManage} ctx={ctx} /> : null
        }
      />
      <GeneratedValue
        value={
          active === 'projects' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={orgData.filteredProjectCount}
              placeholder={tGenerated('m_0aeb3f9e506c57')}
            >
              <ProjectsTab unit={unit} projects={orgData.projects} canManage={canManage} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'sites' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={orgData.filteredSiteCount}
              placeholder={tGenerated('m_1931aa93098220')}
            >
              <SitesTab sites={orgData.sites} showParent />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'contacts' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={contactData.filteredTotal}
              placeholder={tGenerated('m_1485419f15886a')}
            >
              <ContactsTab unit={unit} contacts={contactData.rows} canManage={canManage} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'incidents' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={incidentData.filteredTotal}
              placeholder={tGenerated('m_11a87bf6094fb3')}
              filters={
                <FilterChips
                  basePath={basePath}
                  currentParams={sp}
                  paramKey={listKeys.filter}
                  pageParamKey={listKeys.page}
                  label={tGenerated('m_0b9da892d6faf0')}
                  options={[...INCIDENT_STATUSES]}
                />
              }
            >
              <IncidentsTab rows={incidentData.rows} timeZone={ctx.timezone} locale={ctx.locale} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'equipment' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={equipmentData.filteredTotal}
              placeholder={tGenerated('m_169312ecf5d54b')}
              filters={
                <FilterChips
                  basePath={basePath}
                  currentParams={sp}
                  paramKey={listKeys.filter}
                  pageParamKey={listKeys.page}
                  label={tGenerated('m_0b9da892d6faf0')}
                  options={[...EQUIPMENT_STATUSES]}
                />
              }
            >
              <EquipmentTab equipment={equipmentData.rows} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'activity' ? (
            <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
          ) : null
        }
      />
      <GeneratedValue
        value={
          canManage ? (
            <ContactDrawer
              open={drawer === 'new-contact' || drawer === 'edit-contact'}
              orgUnitId={id}
              contact={resolveEditContact(contactData.editing, drawer)}
              closeHref={`${basePath}?tab=contacts`}
              createAction={createContactFromDrawer}
              updateAction={updateContactFromDrawer}
            />
          ) : null
        }
      />
    </DetailPageLayout>
  )
}

// -------------------- Project view --------------------

async function renderProject({
  unit,
  parent,
  sp,
  listParams,
  drawer,
  editContactId,
  id,
  ctx,
  hierarchy,
  canManage,
}: {
  unit: typeof orgUnits.$inferSelect
  parent: typeof orgUnits.$inferSelect | null
  sp: Record<string, string | string[] | undefined>
  listParams: LocationListParams
  drawer: string | null
  editContactId: string | null
  id: string
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
  hierarchy: TenantHierarchy
  canManage: boolean
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const visibleTabs = PROJECT_TABS.filter((t) => t !== 'sites' || hierarchy.site)
  const active: ProjectTab = pickActiveTab(sp, visibleTabs, 'overview')
  const listKeys = LOCATION_LIST_KEYS[active]
  const basePath = `/locations/${id}`
  const [siteData, contactData, descendantIds] = await Promise.all([
    ctx.db(async (tx) => {
      const base = and(eq(orgUnits.parentId, id), eq(orgUnits.level, 'site'))
      const search = listParams.q
        ? or(ilike(orgUnits.name, `%${listParams.q}%`), ilike(orgUnits.code, `%${listParams.q}%`))
        : undefined
      const filtered = and(base, search)
      const [[totalRow], [filteredRow], rows] = await Promise.all([
        tx.select({ c: count() }).from(orgUnits).where(base),
        active === 'sites'
          ? tx.select({ c: count() }).from(orgUnits).where(filtered)
          : Promise.resolve([]),
        active === 'sites'
          ? tx
              .select()
              .from(orgUnits)
              .where(filtered)
              .orderBy(asc(orgUnits.name), asc(orgUnits.id))
              .limit(listParams.perPage)
              .offset((listParams.page - 1) * listParams.perPage)
          : Promise.resolve([]),
      ])
      return {
        rows: rows.map((unit) => ({ unit, parentName: null })),
        total: Number(totalRow?.c ?? 0),
        filteredTotal: Number(filteredRow?.c ?? 0),
      }
    }),
    loadContactsForUnit(ctx, id, listParams, active === 'contacts', editContactId),
    resolveDescendantIds(ctx, id),
  ])
  const incidentStatus =
    active === 'incidents' ? incidentStatusFrom(pickString(sp[listKeys.filter])) : undefined
  const equipmentStatus =
    active === 'equipment' ? equipmentStatusFrom(pickString(sp[listKeys.filter])) : undefined
  const [incidentData, equipmentData] = await Promise.all([
    loadIncidentsForUnits(ctx, descendantIds, listParams, incidentStatus, active === 'incidents'),
    loadEquipmentForUnits(ctx, descendantIds, listParams, equipmentStatus, active === 'equipment'),
  ])

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'org_unit', id, 25) : []

  const backHref = parent ? `/locations/${parent.id}?tab=projects` : '/locations'
  const backLabel = parent ? `Back to ${parent.name}` : 'Back to locations'

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: backHref, label: backLabel }}
          title={tGeneratedValue(unit.name)}
          subtitle={tGeneratedValue(
            parent
              ? tGenerated('m_167c6af6e54ccc', {
                  value0: levelLabel('project'),
                  value1: parent.name,
                })
              : levelLabel('project'),
          )}
          badge={
            <Badge variant="secondary">
              <GeneratedValue value={levelLabel('project')} />
            </Badge>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          variant="pills"
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'sites', label: 'Sites', count: siteData.total, hidden: !hierarchy.site },
            { key: 'contacts', label: 'Contacts', count: contactData.total },
            { key: 'incidents', label: 'Incidents', count: incidentData.total },
            { key: 'equipment', label: 'Equipment', count: equipmentData.total },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      <GeneratedValue
        value={
          active === 'overview' ? <OverviewTab unit={unit} canManage={canManage} ctx={ctx} /> : null
        }
      />
      <GeneratedValue
        value={
          active === 'sites' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={siteData.filteredTotal}
              placeholder={tGenerated('m_1931aa93098220')}
            >
              <SitesTab sites={siteData.rows} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'contacts' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={contactData.filteredTotal}
              placeholder={tGenerated('m_1485419f15886a')}
            >
              <ContactsTab unit={unit} contacts={contactData.rows} canManage={canManage} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'incidents' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={incidentData.filteredTotal}
              placeholder={tGenerated('m_11a87bf6094fb3')}
              filters={
                <FilterChips
                  basePath={basePath}
                  currentParams={sp}
                  paramKey={listKeys.filter}
                  pageParamKey={listKeys.page}
                  label={tGenerated('m_0b9da892d6faf0')}
                  options={[...INCIDENT_STATUSES]}
                />
              }
            >
              <IncidentsTab rows={incidentData.rows} timeZone={ctx.timezone} locale={ctx.locale} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'equipment' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={equipmentData.filteredTotal}
              placeholder={tGenerated('m_169312ecf5d54b')}
              filters={
                <FilterChips
                  basePath={basePath}
                  currentParams={sp}
                  paramKey={listKeys.filter}
                  pageParamKey={listKeys.page}
                  label={tGenerated('m_0b9da892d6faf0')}
                  options={[...EQUIPMENT_STATUSES]}
                />
              }
            >
              <EquipmentTab equipment={equipmentData.rows} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'activity' ? (
            <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
          ) : null
        }
      />
      <GeneratedValue
        value={
          canManage ? (
            <ContactDrawer
              open={drawer === 'new-contact' || drawer === 'edit-contact'}
              orgUnitId={id}
              contact={resolveEditContact(contactData.editing, drawer)}
              closeHref={`${basePath}?tab=contacts`}
              createAction={createContactFromDrawer}
              updateAction={updateContactFromDrawer}
            />
          ) : null
        }
      />
    </DetailPageLayout>
  )
}

// -------------------- Site view --------------------

async function renderSite({
  unit,
  parent,
  sp,
  listParams,
  drawer,
  editContactId,
  id,
  ctx,
  canManage,
}: {
  unit: typeof orgUnits.$inferSelect
  parent: typeof orgUnits.$inferSelect | null
  sp: Record<string, string | string[] | undefined>
  listParams: LocationListParams
  drawer: string | null
  editContactId: string | null
  id: string
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
  canManage: boolean
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const active: SiteTab = pickActiveTab(sp, SITE_TABS, 'overview')
  const listKeys = LOCATION_LIST_KEYS[active]
  const basePath = `/locations/${id}`
  const contactData = await loadContactsForUnit(
    ctx,
    id,
    listParams,
    active === 'contacts',
    editContactId,
  )
  const incidentStatus =
    active === 'incidents' ? incidentStatusFrom(pickString(sp[listKeys.filter])) : undefined
  const equipmentStatus =
    active === 'equipment' ? equipmentStatusFrom(pickString(sp[listKeys.filter])) : undefined
  const [incidentData, equipmentData] = await Promise.all([
    loadIncidentsForUnits(ctx, [id], listParams, incidentStatus, active === 'incidents'),
    loadEquipmentForUnits(ctx, [id], listParams, equipmentStatus, active === 'equipment'),
  ])

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'org_unit', id, 25) : []

  const backHref = parent ? `/locations/${parent.id}?tab=sites` : '/locations'
  const backLabel = parent ? `Back to ${parent.name}` : 'Back to locations'

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: backHref, label: backLabel }}
          title={tGeneratedValue(unit.name)}
          subtitle={tGeneratedValue(
            parent
              ? tGenerated('m_167c6af6e54ccc', {
                  value0: levelLabel(unit.level),
                  value1: parent.name,
                })
              : levelLabel(unit.level),
          )}
          badge={
            <Badge variant="secondary">
              <GeneratedValue value={levelLabel(unit.level)} />
            </Badge>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          variant="pills"
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'contacts', label: 'Contacts', count: contactData.total },
            { key: 'incidents', label: 'Incidents', count: incidentData.total },
            { key: 'equipment', label: 'Equipment', count: equipmentData.total },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      <GeneratedValue
        value={
          active === 'overview' ? <OverviewTab unit={unit} canManage={canManage} ctx={ctx} /> : null
        }
      />
      <GeneratedValue
        value={
          active === 'contacts' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={contactData.filteredTotal}
              placeholder={tGenerated('m_1485419f15886a')}
            >
              <ContactsTab unit={unit} contacts={contactData.rows} canManage={canManage} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'incidents' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={incidentData.filteredTotal}
              placeholder={tGenerated('m_11a87bf6094fb3')}
              filters={
                <FilterChips
                  basePath={basePath}
                  currentParams={sp}
                  paramKey={listKeys.filter}
                  pageParamKey={listKeys.page}
                  label={tGenerated('m_0b9da892d6faf0')}
                  options={[...INCIDENT_STATUSES]}
                />
              }
            >
              <IncidentsTab rows={incidentData.rows} timeZone={ctx.timezone} locale={ctx.locale} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'equipment' ? (
            <ListTabShell
              basePath={basePath}
              sp={sp}
              params={listParams}
              listKeys={listKeys}
              total={equipmentData.filteredTotal}
              placeholder={tGenerated('m_169312ecf5d54b')}
              filters={
                <FilterChips
                  basePath={basePath}
                  currentParams={sp}
                  paramKey={listKeys.filter}
                  pageParamKey={listKeys.page}
                  label={tGenerated('m_0b9da892d6faf0')}
                  options={[...EQUIPMENT_STATUSES]}
                />
              }
            >
              <EquipmentTab equipment={equipmentData.rows} />
            </ListTabShell>
          ) : null
        }
      />
      <GeneratedValue
        value={
          active === 'activity' ? (
            <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
          ) : null
        }
      />
      <GeneratedValue
        value={
          canManage ? (
            <ContactDrawer
              open={drawer === 'new-contact' || drawer === 'edit-contact'}
              orgUnitId={id}
              contact={resolveEditContact(contactData.editing, drawer)}
              closeHref={`${basePath}?tab=contacts`}
              createAction={createContactFromDrawer}
              updateAction={updateContactFromDrawer}
            />
          ) : null
        }
      />
    </DetailPageLayout>
  )
}

// ---------- Tab content components ----------

/** Find the contact targeted by ?drawer=edit-contact&contactId=… for prefill. */
function resolveEditContact(
  c: typeof customerContacts.$inferSelect | null,
  drawer: string | null,
): ContactRow | null {
  if (drawer !== 'edit-contact' || !c) return null
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    isPrimary: c.isPrimary,
  }
}

function ListTabShell({
  basePath,
  sp,
  params,
  listKeys,
  total,
  placeholder,
  filters,
  children,
}: {
  basePath: string
  sp: Record<string, string | string[] | undefined>
  params: LocationListParams
  listKeys: LocationListKeys
  total: number
  placeholder: string
  filters?: ReactNode
  children: ReactNode
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <div className="space-y-3">
      <TableToolbar>
        <SearchInput
          placeholder={tGeneratedValue(placeholder)}
          paramKey={listKeys.q}
          pageParamKey={listKeys.page}
        />
        <GeneratedValue value={filters} />
      </TableToolbar>
      <GeneratedValue value={children} />
      <Pagination
        basePath={basePath}
        currentParams={sp}
        total={total}
        page={params.page}
        perPage={params.perPage}
        pageParamKey={listKeys.page}
      />
    </div>
  )
}

async function OverviewTab({
  unit,
  canManage,
  ctx,
}: {
  unit: typeof orgUnits.$inferSelect
  canManage: boolean
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const addr = unit.address ?? {}
  const mapsHref =
    unit.lat != null && unit.lng != null
      ? `https://www.google.com/maps?q=${unit.lat},${unit.lng}`
      : null
  return (
    <div className="space-y-4">
      <Section title={tGenerated('m_10cb4da67c8c08')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <LiveField
              id={unit.id}
              field="name"
              label={tGenerated('m_02b18d5c7f6f2d')}
              initialValue={unit.name}
              disabled={!canManage}
              updateAction={updateLocationField}
            />
          </div>
          <LiveField
            id={unit.id}
            field="code"
            label={tGenerated('m_0570e24c85cf95')}
            initialValue={unit.code}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
        </div>
      </Section>

      <Section title={tGenerated('m_02d326d09a4cc1')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <LiveField
              id={unit.id}
              field="addressLine1"
              label={tGenerated('m_13c9eb2e75e0da')}
              initialValue={addr.line1 ?? null}
              disabled={!canManage}
              updateAction={updateLocationField}
            />
          </div>
          <div className="sm:col-span-2">
            <LiveField
              id={unit.id}
              field="addressLine2"
              label={tGenerated('m_0abb02292d9133')}
              initialValue={addr.line2 ?? null}
              disabled={!canManage}
              updateAction={updateLocationField}
            />
          </div>
          <LiveField
            id={unit.id}
            field="addressCity"
            label={tGenerated('m_0f8706f757eeb9')}
            initialValue={addr.city ?? null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
          <LiveField
            id={unit.id}
            field="addressRegion"
            label={tGenerated('m_1f186e5abd90ed')}
            initialValue={addr.region ?? null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
          <LiveField
            id={unit.id}
            field="addressPostal"
            label={tGenerated('m_0a022396d35be5')}
            initialValue={addr.postal ?? null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
          <LiveField
            id={unit.id}
            field="addressCountry"
            label={tGenerated('m_1bcca98c4d6c29')}
            initialValue={addr.country ?? null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
        </div>
      </Section>

      <Section title={tGenerated('m_1e55796d4f87d2')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <LiveField
            id={unit.id}
            field="lat"
            label={tGenerated('m_1234a6d40fbc9d')}
            type="number"
            initialValue={unit.lat != null ? String(unit.lat) : null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
          <LiveField
            id={unit.id}
            field="lng"
            label={tGenerated('m_1c3995aeba4fd9')}
            type="number"
            initialValue={unit.lng != null ? String(unit.lng) : null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
          <LiveField
            id={unit.id}
            field="geofenceMeters"
            label={tGenerated('m_1e7bd588f4976f')}
            type="number"
            initialValue={unit.geofenceMeters != null ? String(unit.geofenceMeters) : null}
            disabled={!canManage}
            updateAction={updateLocationField}
          />
        </div>
      </Section>

      <CustomFieldsSection
        ctx={ctx}
        entityKind="location"
        recordId={unit.id}
        subtypeId={null}
        metadata={unit.metadata}
        locked={!canManage}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <GeneratedText id="m_180c776129a91f" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GeneratedValue
            value={
              unit.lat != null && unit.lng != null ? (
                <div className="space-y-3">
                  <iframe
                    title={tGenerated('m_0e9bda3cb6b9b3')}
                    width="100%"
                    height="320"
                    loading="lazy"
                    className="rounded-md border border-slate-200"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${(unit.lng - 0.005).toFixed(5)}%2C${(unit.lat - 0.003).toFixed(5)}%2C${(unit.lng + 0.005).toFixed(5)}%2C${(unit.lat + 0.003).toFixed(5)}&layer=mapnik&marker=${unit.lat}%2C${unit.lng}`}
                  />
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>
                      <MapPin size={12} className="-mt-0.5 mr-1 inline" />
                      <GeneratedValue value={unit.lat.toFixed(5)} />,{' '}
                      <GeneratedValue value={unit.lng.toFixed(5)} />
                    </span>
                    <GeneratedValue
                      value={
                        mapsHref ? (
                          <a
                            href={mapsHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-teal-700 hover:underline"
                          >
                            <GeneratedText id="m_05eca93b18873b" />
                          </a>
                        ) : null
                      }
                    />
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<MapPin size={24} />}
                  title={tGenerated('m_09e620fe5fc423')}
                  description={tGenerated('m_1f9e6dd6666220')}
                />
              )
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}

function ProjectsTab({
  unit,
  projects,
  canManage,
}: {
  unit: typeof orgUnits.$inferSelect
  projects: (typeof orgUnits.$inferSelect)[]
  canManage: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-4">
      <GeneratedValue
        value={
          canManage ? (
            <div className="flex items-center justify-end">
              <form action={createProject}>
                <input type="hidden" name="parentId" value={unit.id} />
                <Button type="submit">
                  <Plus size={14} /> <GeneratedText id="m_1b876f79d3bd88" />
                </Button>
              </form>
            </div>
          ) : null
        }
      />
      <GeneratedValue
        value={
          projects.length === 0 ? (
            <EmptyState
              icon={<Folder size={32} />}
              title={tGenerated('m_0d430535129f9e')}
              description={tGenerated('m_1887234fe137c9')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <GeneratedText id="m_05069b4b587da8" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_0570e24c85cf95" />
                  </TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <GeneratedValue
                  value={projects.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/locations/${p.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={p.name} />
                          </Link>
                          <GeneratedValue
                            value={
                              p.deletedAt ? (
                                <Badge variant="warning">
                                  <GeneratedText id="m_12a687134482ba" />
                                </Badge>
                              ) : null
                            }
                          />
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">
                        <GeneratedValue value={p.code ?? '—'} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/locations/${p.id}`}
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
    </div>
  )
}

function SitesTab({
  sites,
  showParent = false,
}: {
  sites: { unit: typeof orgUnits.$inferSelect; parentName: string | null }[]
  showParent?: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  if (sites.length === 0) {
    return (
      <EmptyState
        icon={<MapPin size={32} />}
        title={tGenerated('m_039b3b14ce95cb')}
        description={tGenerated('m_0e058ebbfcf047')}
      />
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <GeneratedText id="m_020146dd3d3d5a" />
          </TableHead>
          <GeneratedValue
            value={
              showParent ? (
                <TableHead>
                  <GeneratedText id="m_05069b4b587da8" />
                </TableHead>
              ) : null
            }
          />
          <TableHead>
            <GeneratedText id="m_0570e24c85cf95" />
          </TableHead>
          <TableHead>
            <GeneratedText id="m_00112966136b6e" />
          </TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <GeneratedValue
          value={sites.map(({ unit: s, parentName }) => (
            <TableRow key={s.id}>
              <TableCell>
                <Link
                  href={`/locations/${s.id}`}
                  className="font-medium text-slate-900 hover:underline"
                >
                  <GeneratedValue value={s.name} />
                </Link>
              </TableCell>
              <GeneratedValue
                value={
                  showParent ? (
                    <TableCell className="text-slate-600">
                      <GeneratedValue value={parentName ?? '—'} />
                    </TableCell>
                  ) : null
                }
              />
              <TableCell className="font-mono text-xs text-slate-600">
                <GeneratedValue value={s.code ?? '—'} />
              </TableCell>
              <TableCell className="text-slate-600">
                <GeneratedValue
                  value={
                    s.lat != null && s.lng != null
                      ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`
                      : '—'
                  }
                />
              </TableCell>
              <TableCell className="text-right">
                <Link href={`/locations/${s.id}`} className="text-xs text-teal-700 hover:underline">
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

function ContactsTab({
  unit,
  contacts,
  canManage,
}: {
  unit: typeof orgUnits.$inferSelect
  contacts: (typeof customerContacts.$inferSelect)[]
  canManage: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-4">
      <GeneratedValue
        value={
          canManage ? (
            <div className="flex items-center justify-end">
              <Link href={`/locations/${unit.id}?tab=contacts&drawer=new-contact`}>
                <Button>
                  <Plus size={14} /> <GeneratedText id="m_00da93f3990e7a" />
                </Button>
              </Link>
            </div>
          ) : null
        }
      />
      <GeneratedValue
        value={
          contacts.length === 0 ? (
            <EmptyState
              icon={<Users size={32} />}
              title={tGenerated('m_149f22842b1960')}
              description={tGenerated('m_0c51dcd14d49fc')}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <GeneratedText id="m_02b18d5c7f6f2d" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_1099c1fe8b6614" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_00a0ba9938bdff" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_129b102b56bf3a" />
                  </TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <GeneratedValue
                  value={contacts.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">
                            <GeneratedValue value={c.name} />
                          </span>
                          <GeneratedValue
                            value={
                              c.isPrimary ? (
                                <Badge variant="success" className="gap-1">
                                  <Star size={10} /> <GeneratedText id="m_18aec830eeb5e0" />
                                </Badge>
                              ) : null
                            }
                          />
                        </div>
                        <GeneratedValue
                          value={
                            c.notes ? (
                              <div className="text-xs text-slate-500">
                                <GeneratedValue value={c.notes} />
                              </div>
                            ) : null
                          }
                        />
                      </TableCell>
                      <TableCell className="text-slate-600">
                        <GeneratedValue value={c.role ?? '—'} />
                      </TableCell>
                      <TableCell className="text-slate-600">
                        <GeneratedValue
                          value={
                            c.email ? (
                              <a
                                href={`mailto:${c.email}`}
                                className="inline-flex items-center gap-1 text-teal-700 hover:underline"
                              >
                                <Mail size={12} /> <GeneratedValue value={c.email} />
                              </a>
                            ) : (
                              '—'
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-slate-600">
                        <GeneratedValue
                          value={
                            c.phone ? (
                              <a
                                href={`tel:${c.phone}`}
                                className="inline-flex items-center gap-1 text-teal-700 hover:underline"
                              >
                                <Phone size={12} /> <GeneratedValue value={c.phone} />
                              </a>
                            ) : (
                              '—'
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <GeneratedValue
                          value={
                            canManage ? (
                              <div className="flex items-center justify-end gap-1">
                                <Link
                                  href={`/locations/${unit.id}?tab=contacts&drawer=edit-contact&contactId=${c.id}`}
                                >
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                    aria-label={tGenerated('m_0a45a3f047a285', { value0: c.name })}
                                  >
                                    <Pencil size={14} />
                                  </Button>
                                </Link>
                                <form action={deleteContact} className="inline">
                                  <input type="hidden" name="id" value={c.id} />
                                  <input type="hidden" name="orgUnitId" value={unit.id} />
                                  <Button
                                    type="submit"
                                    variant="ghost"
                                    size="sm"
                                    className="text-red-500 hover:text-red-700"
                                    aria-label={tGenerated('m_101f98a70352fa', { value0: c.name })}
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </form>
                              </div>
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
    </div>
  )
}

function IncidentsTab({
  rows,
  timeZone,
  locale,
}: {
  rows: (typeof incidents.$inferSelect)[]
  timeZone: string
  locale: AppLocale
}) {
  const tGenerated = useGeneratedTranslations()
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<AlertTriangle size={32} />}
        title={tGenerated('m_177f8be6c7aad5')}
        description={tGenerated('m_01f410d09c88d5')}
        action={
          <Link href={`/incidents/new`}>
            <Button variant="outline" size="sm">
              <GeneratedText id="m_1e6299ac4979b3" />
            </Button>
          </Link>
        }
      />
    )
  }
  return (
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
            <GeneratedText id="m_168b365cc671bf" />
          </TableHead>
          <TableHead>
            <GeneratedText id="m_0b9da892d6faf0" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <GeneratedValue
          value={rows.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-mono text-xs">
                <Link href={`/incidents/${i.id}`} className="hover:underline">
                  <GeneratedValue value={i.reference} />
                </Link>
              </TableCell>
              <TableCell>
                <GeneratedValue value={formatDate(new Date(i.occurredAt), timeZone, locale)} />
              </TableCell>
              <TableCell>
                <GeneratedValue value={i.title} />
              </TableCell>
              <TableCell>
                <Badge variant={severityVariant(i.severity)}>
                  <GeneratedValue value={i.severity} />
                </Badge>
              </TableCell>
              <TableCell className="text-slate-600">
                <GeneratedValue value={i.status.replace(/_/g, ' ')} />
              </TableCell>
            </TableRow>
          ))}
        />
      </TableBody>
    </Table>
  )
}

function EquipmentTab({
  equipment,
}: {
  equipment: {
    item: typeof equipmentItems.$inferSelect
    type: typeof equipmentTypes.$inferSelect | null
    holder: typeof people.$inferSelect | null
  }[]
}) {
  const tGenerated = useGeneratedTranslations()
  if (equipment.length === 0) {
    return (
      <EmptyState
        icon={<Truck size={32} />}
        title={tGenerated('m_0548db7bda45b3')}
        description={tGenerated('m_01faba9f240948')}
        action={
          <Link href={`/equipment`}>
            <Button variant="outline" size="sm">
              <GeneratedText id="m_01e20b5fb6d390" />
            </Button>
          </Link>
        }
      />
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <GeneratedText id="m_0d9ccb155777db" />
          </TableHead>
          <TableHead>
            <GeneratedText id="m_02b18d5c7f6f2d" />
          </TableHead>
          <TableHead>
            <GeneratedText id="m_074ba2f160c506" />
          </TableHead>
          <TableHead>
            <GeneratedText id="m_1dd437d2b4ab7f" />
          </TableHead>
          <TableHead>
            <GeneratedText id="m_0b9da892d6faf0" />
          </TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <GeneratedValue
          value={equipment.map((row) => (
            <TableRow key={row.item.id}>
              <TableCell className="font-mono text-xs">
                <GeneratedValue value={row.item.assetTag} />
              </TableCell>
              <TableCell className="font-medium">
                <GeneratedValue value={row.item.name} />
              </TableCell>
              <TableCell className="text-slate-600">
                <GeneratedValue value={row.type?.name ?? '—'} />
              </TableCell>
              <TableCell className="text-slate-600">
                <GeneratedValue
                  value={
                    row.holder ? (
                      <Link
                        href={`/people/${row.holder.id}`}
                        className="text-teal-700 hover:underline"
                      >
                        <GeneratedValue value={row.holder.firstName} />{' '}
                        <GeneratedValue value={row.holder.lastName} />
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
              </TableCell>
              <TableCell>
                <Badge variant={row.item.status === 'in_service' ? 'success' : 'warning'}>
                  <GeneratedValue value={row.item.status.replace('_', ' ')} />
                </Badge>
              </TableCell>
              <TableCell>
                <Link
                  href={`/equipment/${row.item.id}`}
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

// ---------- Helpers ----------

function severityVariant(s: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (s === 'fatality' || s === 'lost_time') return 'destructive'
  if (s === 'medical_aid') return 'warning'
  if (s === 'first_aid_only') return 'secondary'
  return 'secondary'
}
