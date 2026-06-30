// Shared designer page for tenant-defined custom fields. One component, mounted
// by a thin route per entity kind (equipment / ppe / people / locations). Lists
// the kind's field definitions and drives the create/edit drawer + delete.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import {
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
import { mergeHref, pickString } from '@/lib/list-params'
import { entityConfig } from '@/lib/custom-fields/config'
import { loadAllCustomFieldDefs, loadSubtypeOptions } from '@/lib/custom-fields/queries'
import { deleteCustomFieldDefAction, saveCustomFieldDefAction } from '@/lib/custom-fields/actions'
import { CustomFieldsDesignerDrawer, type DesignerEditing } from './custom-fields-designer-drawer'

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
  const base = cfg.designerPath

  const [defs, subtypeOptions] = await Promise.all([
    loadAllCustomFieldDefs(ctx, kind),
    cfg.hasSubtype ? loadSubtypeOptions(ctx, kind) : Promise.resolve([]),
  ])
  const subtypeName = new Map(subtypeOptions.map((s) => [s.id, s.name]))

  const editingRow =
    drawerParam && drawerParam !== 'new' ? (defs.find((d) => d.id === drawerParam) ?? null) : null
  const editing: DesignerEditing | null = editingRow
    ? {
        id: editingRow.id,
        label: editingRow.label,
        helpText: editingRow.helpText,
        fieldType: editingRow.fieldType,
        required: editingRow.required,
        groupLabel: editingRow.groupLabel,
        subtypeId: editingRow.subtypeId,
        sortOrder: editingRow.sortOrder,
        isActive: editingRow.isActive,
        config: editingRow.config,
      }
    : null
  const mode: 'new' | 'edit' | null = drawerParam === 'new' ? 'new' : editing ? 'edit' : null
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
        </>
      }
    >
      {defs.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal size={32} />}
          title="No custom fields yet"
          description={`Add a field to capture extra information on every ${cfg.singular}.`}
          action={
            <Link href={newHref as never} scroll={false}>
              <Button>New field</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
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
                      {d.groupLabel ?? <span className="text-slate-400">—</span>}
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
                          <button
                            type="submit"
                            title="Delete field"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CustomFieldsDesignerDrawer
        mode={mode}
        editing={editing}
        kind={kind}
        hasSubtype={cfg.hasSubtype}
        subtypeLabel={cfg.subtypeLabel}
        subtypeOptions={subtypeOptions}
        closeHref={closeHref}
        saveAction={saveCustomFieldDefAction}
      />
    </ListPageLayout>
  )
}
