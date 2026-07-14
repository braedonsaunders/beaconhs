// Shared designer page for tenant-defined custom fields. One component, mounted
// by a thin route per entity kind (equipment / ppe / people / locations). Lists
// the kind's field definitions and drives the create/edit drawer + delete.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { CUSTOM_FIELD_TYPE_META, type CustomFieldEntityKind } from '@beaconhs/forms-core'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { ModuleNav } from '@/components/module-admin/module-nav'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { entityConfig } from '@/lib/custom-fields/config'
import { customFieldDependencyMessage } from '@/lib/custom-fields/analytics-dependency-policy'
import { EQUIPMENT_FIELD_GROUPS } from '@/lib/equipment/field-groups'
import {
  loadCustomFieldDefById,
  loadCustomFieldDefPage,
  loadSubtypeOptions,
} from '@/lib/custom-fields/queries'
import { deleteCustomFieldDefAction, saveCustomFieldDefAction } from '@/lib/custom-fields/actions'
import { ConfirmButton } from '@/components/confirm-button'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { CustomFieldsDesignerDrawer, type DesignerEditing } from './custom-fields-designer-drawer'

const SORTS = ['label'] as const
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'hidden', label: 'Hidden' },
] as const

function dependencyCount(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(pickString(value) ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

export async function CustomFieldsAdminPage({
  kind,
  searchParams,
}: {
  kind: CustomFieldEntityKind
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const cfg = entityConfig(kind)
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, cfg.permission)) redirect(cfg.list)

  const sp = await searchParams
  const drawerParam = pickString(sp.drawer)
  const requestedStatus = pickString(sp.status)
  const status = STATUS_OPTIONS.some((option) => option.value === requestedStatus)
    ? (requestedStatus as 'active' | 'hidden')
    : undefined
  const listParams = parseListParams(sp, {
    sort: 'label',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const base = cfg.designerPath
  const blockedDependencies =
    pickString(sp.deleteError) === 'analytics_dependencies'
      ? { reports: dependencyCount(sp.reports), cards: dependencyCount(sp.cards) }
      : null
  const dismissErrorHref = mergeHref(base, sp, {
    deleteError: undefined,
    reports: undefined,
    cards: undefined,
  })

  const [definitionPage, subtypeOptions, editingRow] = await Promise.all([
    loadCustomFieldDefPage(ctx, kind, {
      q: listParams.q,
      status,
      page: listParams.page,
      perPage: listParams.perPage,
    }),
    cfg.hasSubtype ? loadSubtypeOptions(ctx, kind) : Promise.resolve([]),
    drawerParam && drawerParam !== 'new'
      ? loadCustomFieldDefById(ctx, kind, drawerParam)
      : Promise.resolve(null),
  ])
  const { rows: defs, total } = definitionPage
  const subtypeName = new Map(subtypeOptions.map((s) => [s.id, s.name]))

  const editing: DesignerEditing | null = editingRow
    ? {
        id: editingRow.id,
        label: editingRow.label,
        helpText: editingRow.helpText,
        fieldType: editingRow.fieldType,
        required: editingRow.required,
        groupLabel: editingRow.groupLabel,
        groupKey: editingRow.groupKey,
        subtypeId: editingRow.subtypeId,
        sortOrder: editingRow.sortOrder,
        isActive: editingRow.isActive,
        config: editingRow.config,
      }
    : null
  const mode: 'new' | 'edit' | null = drawerParam === 'new' ? 'new' : editing ? 'edit' : null
  // Native-group placement targets (equipment only).
  const nativeGroups =
    kind === 'equipment' ? EQUIPMENT_FIELD_GROUPS.map((g) => ({ key: g.key, label: g.label })) : []
  const nativeGroupLabel = new Map(nativeGroups.map((g) => [g.key, g.label]))
  const closeHref = mergeHref(base, sp, { drawer: undefined })
  const newHref = mergeHref(base, sp, { drawer: 'new' })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={`${cfg.label} custom fields`}
            description={`Extra attributes captured on each ${cfg.singular}. Values save inline on the record.`}
            back={{ href: cfg.list, label: `Back to ${cfg.label}` }}
            actions={
              <Link href={newHref as never} scroll={false}>
                <Button>
                  <Plus size={14} /> New field
                </Button>
              </Link>
            }
          />
          {cfg.moduleKey ? <ModuleNav moduleKey={cfg.moduleKey} active="custom-fields" /> : null}
          {blockedDependencies &&
          (blockedDependencies.reports > 0 || blockedDependencies.cards > 0) ? (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>{customFieldDependencyMessage(blockedDependencies)}</span>
                <Link className="shrink-0 font-medium underline" href={dismissErrorHref as never}>
                  Dismiss
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}
          <TableToolbar>
            <SearchInput placeholder="Search custom fields…" />
            <FilterChips
              basePath={base}
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={[...STATUS_OPTIONS]}
            />
          </TableToolbar>
        </>
      }
    >
      {defs.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal size={32} />}
          title={
            listParams.q || status ? 'No custom fields match these filters' : 'No custom fields yet'
          }
          description={
            listParams.q || status
              ? 'Clear the search or status filter to see other fields.'
              : `Add a field to capture extra information on every ${cfg.singular}.`
          }
          action={
            <Link href={newHref as never} scroll={false}>
              <Button>New field</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Type</TableHead>
                  {cfg.hasSubtype ? <TableHead>Scope</TableHead> : null}
                  <TableHead>Group</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {defs.map((d) => {
                  const editHref = mergeHref(base, sp, { drawer: d.id })
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Link
                          href={editHref as never}
                          scroll={false}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {d.label}
                        </Link>
                        <div className="mt-0.5 font-mono text-xs text-slate-400 dark:text-slate-500">
                          {d.key}
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {CUSTOM_FIELD_TYPE_META[d.fieldType].label}
                      </TableCell>
                      {cfg.hasSubtype ? (
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {d.subtypeId ? (
                            (subtypeName.get(d.subtypeId) ?? '—')
                          ) : (
                            <span className="text-slate-400">All</span>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {d.groupKey ? (
                          <Badge variant="secondary">
                            {nativeGroupLabel.get(d.groupKey) ?? d.groupKey}
                          </Badge>
                        ) : (
                          (d.groupLabel ?? <span className="text-slate-400">—</span>)
                        )}
                      </TableCell>
                      <TableCell>
                        {d.required ? (
                          <Badge variant="secondary">Required</Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {d.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="outline">Hidden</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Link
                            href={editHref as never}
                            scroll={false}
                            className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
                          >
                            Edit
                          </Link>
                          <form action={deleteCustomFieldDefAction} className="inline">
                            <input type="hidden" name="kind" value={kind} />
                            <input type="hidden" name="id" value={d.id} />
                            <ConfirmButton
                              variant="ghost"
                              size="icon"
                              message={`Delete the "${d.label}" field and permanently remove its captured values from every ${cfg.singular}?`}
                              className="h-7 w-7 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                            >
                              <Trash2 size={14} />
                              <span className="sr-only">Delete field</span>
                            </ConfirmButton>
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination
            basePath={base}
            currentParams={sp}
            total={total}
            page={listParams.page}
            perPage={listParams.perPage}
          />
        </div>
      )}

      <CustomFieldsDesignerDrawer
        mode={mode}
        editing={editing}
        kind={kind}
        hasSubtype={cfg.hasSubtype}
        subtypeLabel={cfg.subtypeLabel}
        subtypeOptions={subtypeOptions}
        nativeGroups={nativeGroups}
        closeHref={closeHref}
        saveAction={saveCustomFieldDefAction}
      />
    </ListPageLayout>
  )
}
