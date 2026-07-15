import { getGeneratedValueTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_1f49fdf67f272f', { value0: cfg.label })}
            description={tGenerated('m_1a6a5af5965659', { value0: cfg.singular })}
            back={{ href: cfg.list, label: `Back to ${cfg.label}` }}
            actions={
              <Link href={newHref as never} scroll={false}>
                <Button>
                  <Plus size={14} /> <GeneratedText id="m_10786c33e03a3f" />
                </Button>
              </Link>
            }
          />
          <GeneratedValue
            value={
              cfg.moduleKey ? <ModuleNav moduleKey={cfg.moduleKey} active="custom-fields" /> : null
            }
          />
          <GeneratedValue
            value={
              blockedDependencies &&
              (blockedDependencies.reports > 0 || blockedDependencies.cards > 0) ? (
                <Alert variant="destructive">
                  <AlertDescription className="flex items-center justify-between gap-3">
                    <span>
                      <GeneratedValue value={customFieldDependencyMessage(blockedDependencies)} />
                    </span>
                    <Link
                      className="shrink-0 font-medium underline"
                      href={dismissErrorHref as never}
                    >
                      <GeneratedText id="m_024331c508a2cd" />
                    </Link>
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_063276a6256476')} />
            <FilterChips
              basePath={base}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={[...STATUS_OPTIONS]}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          defs.length === 0 ? (
            <EmptyState
              icon={<SlidersHorizontal size={32} />}
              title={tGeneratedValue(
                listParams.q || status
                  ? tGenerated('m_1432422b8b9c9f')
                  : tGenerated('m_1c755534bff299'),
              )}
              description={tGeneratedValue(
                listParams.q || status
                  ? tGenerated('m_0e2ee0e5d3b685')
                  : tGenerated('m_041233d5d7d84a', { value0: cfg.singular }),
              )}
              action={
                <Link href={newHref as never} scroll={false}>
                  <Button>
                    <GeneratedText id="m_10786c33e03a3f" />
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <GeneratedText id="m_1dfe960eaa6224" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_074ba2f160c506" />
                      </TableHead>
                      <GeneratedValue
                        value={
                          cfg.hasSubtype ? (
                            <TableHead>
                              <GeneratedText id="m_1f10a46fc1db73" />
                            </TableHead>
                          ) : null
                        }
                      />
                      <TableHead>
                        <GeneratedText id="m_0d06af9d4c7f60" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_12fe2fe7a9ddad" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_0b9da892d6faf0" />
                      </TableHead>
                      <TableHead className="text-right">
                        <GeneratedText id="m_0a7f1858f2ec46" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GeneratedValue
                      value={defs.map((d) => {
                        const editHref = mergeHref(base, sp, { drawer: d.id })
                        return (
                          <TableRow key={d.id}>
                            <TableCell>
                              <Link
                                href={editHref as never}
                                scroll={false}
                                className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                              >
                                <GeneratedValue value={d.label} />
                              </Link>
                              <div className="mt-0.5 font-mono text-xs text-slate-400 dark:text-slate-500">
                                <GeneratedValue value={d.key} />
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-400">
                              <GeneratedValue value={CUSTOM_FIELD_TYPE_META[d.fieldType].label} />
                            </TableCell>
                            <GeneratedValue
                              value={
                                cfg.hasSubtype ? (
                                  <TableCell className="text-slate-600 dark:text-slate-400">
                                    <GeneratedValue
                                      value={
                                        d.subtypeId ? (
                                          (subtypeName.get(d.subtypeId) ?? '—')
                                        ) : (
                                          <span className="text-slate-400">
                                            <GeneratedText id="m_17201516610431" />
                                          </span>
                                        )
                                      }
                                    />
                                  </TableCell>
                                ) : null
                              }
                            />
                            <TableCell className="text-slate-600 dark:text-slate-400">
                              <GeneratedValue
                                value={
                                  d.groupKey ? (
                                    <Badge variant="secondary">
                                      <GeneratedValue
                                        value={nativeGroupLabel.get(d.groupKey) ?? d.groupKey}
                                      />
                                    </Badge>
                                  ) : (
                                    (d.groupLabel ?? <span className="text-slate-400">—</span>)
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <GeneratedValue
                                value={
                                  d.required ? (
                                    <Badge variant="secondary">
                                      <GeneratedText id="m_12fe2fe7a9ddad" />
                                    </Badge>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <GeneratedValue
                                value={
                                  d.isActive ? (
                                    <Badge variant="success">
                                      <GeneratedText id="m_1e1b1fdb7dd78e" />
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline">
                                      <GeneratedText id="m_01cb6961ee0ba3" />
                                    </Badge>
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="inline-flex items-center gap-1">
                                <Link
                                  href={editHref as never}
                                  scroll={false}
                                  className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
                                >
                                  <GeneratedText id="m_03a66f9d34ac7b" />
                                </Link>
                                <form action={deleteCustomFieldDefAction} className="inline">
                                  <input type="hidden" name="kind" value={kind} />
                                  <input type="hidden" name="id" value={d.id} />
                                  <ConfirmButton
                                    variant="ghost"
                                    size="icon"
                                    message={tGenerated('m_12888ae5874f1b', {
                                      value0: d.label,
                                      value1: cfg.singular,
                                    })}
                                    className="h-7 w-7 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                  >
                                    <Trash2 size={14} />
                                    <span className="sr-only">
                                      <GeneratedText id="m_04b43efef2bd7b" />
                                    </span>
                                  </ConfirmButton>
                                </form>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    />
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
          )
        }
      />

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
