// /admin/data-sources — tenant admins curate the DATA SOURCES that data-bound
// app elements (lookup, cascading dropdowns, data-table, KPI/chart) read from.
//
// Two kinds:
//   - reference: hand-curated rows (managed on the detail page).
//   - responses: live rows derived from a chosen app's submitted responses;
//     columns are snapshotted from that app's fields on creation.
//
// Gated by admin.settings.manage (same tier as AI providers). All mutations
// recordAudit (entityType='data_source').

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Database, Plus, Table2, Trash2, ArrowUpRight } from 'lucide-react'
import { asc, desc, eq, isNull, sql } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import {
  dataSourceRows,
  dataSources,
  formTemplateVersions,
  formTemplates,
  type DataSourceColumn,
} from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'
import { deriveColumnsFromSchema, slugify } from './_shared'

export const metadata = { title: 'Data sources' }
export const dynamic = 'force-dynamic'

async function createDataSource(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) return
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const kind = formData.get('kind') === 'responses' ? 'responses' : 'reference'
  const templateId = String(formData.get('templateId') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null

  // Unique, stable slug per tenant. Append a counter on collision.
  const base = slugify(String(formData.get('key') ?? '').trim() || name)
  const newId = await ctx.db(async (tx) => {
    const existing = await tx
      .select({ key: dataSources.key })
      .from(dataSources)
      .where(isNull(dataSources.deletedAt))
    const taken = new Set(existing.map((r) => r.key))
    let key = base
    let n = 2
    while (taken.has(key)) key = `${base}-${n++}`

    // For a responses-kind source, snapshot columns from the chosen app's
    // latest schema so metric/groupBy editors have fields to offer.
    let columns: DataSourceColumn[] = []
    let config: { templateId?: string } = {}
    if (kind === 'responses' && templateId) {
      const [ver] = await tx
        .select({ schema: formTemplateVersions.schema })
        .from(formTemplateVersions)
        .where(eq(formTemplateVersions.templateId, templateId))
        .orderBy(desc(formTemplateVersions.version))
        .limit(1)
      if (ver?.schema) columns = deriveColumnsFromSchema(ver.schema as FormSchemaV1)
      config = { templateId }
    }

    const [row] = await tx
      .insert(dataSources)
      .values({
        tenantId: ctx.tenantId,
        key,
        name,
        description,
        kind,
        columns,
        config,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: dataSources.id })
    return row?.id ?? null
  })

  if (newId) {
    await recordAudit(ctx, {
      entityType: 'data_source',
      entityId: newId,
      action: 'create',
      summary: `Created data source "${name}" (${kind})`,
      after: { name, kind },
    })
    revalidatePath('/admin/data-sources')
    redirect(`/admin/data-sources/${newId}`)
  }
  revalidatePath('/admin/data-sources')
}

async function deleteDataSource(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx.update(dataSources).set({ deletedAt: new Date() }).where(eq(dataSources.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'data_source',
    entityId: id,
    action: 'delete',
    summary: 'Deleted data source',
  })
  revalidatePath('/admin/data-sources')
}

export default async function DataSourcesPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const { sources, templates } = await ctx.db(async (tx) => {
    const all = await tx
      .select({
        id: dataSources.id,
        key: dataSources.key,
        name: dataSources.name,
        description: dataSources.description,
        kind: dataSources.kind,
        columns: dataSources.columns,
        config: dataSources.config,
      })
      .from(dataSources)
      .where(isNull(dataSources.deletedAt))
      .orderBy(asc(dataSources.name))

    const counts = await tx
      .select({ sid: dataSourceRows.dataSourceId, c: sql<number>`count(*)` })
      .from(dataSourceRows)
      .where(isNull(dataSourceRows.deletedAt))
      .groupBy(dataSourceRows.dataSourceId)
    const countMap: Record<string, number> = {}
    for (const c of counts) countMap[c.sid] = Number(c.c)

    const tmpls = await tx
      .select({ id: formTemplates.id, name: formTemplates.name })
      .from(formTemplates)
      .orderBy(asc(formTemplates.name))

    return {
      sources: all.map((s) => ({ ...s, rowCount: countMap[s.id] ?? 0 })),
      templates: tmpls,
    }
  })

  return (
    <PageContainer>
      <div className="space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Database size={22} className="text-teal-600" />
            <h1 className="text-2xl font-semibold text-slate-900">Data sources</h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-500">
            Reusable lists + live data that your apps bind to — for lookup auto-fill, cascading
            dropdowns, data tables and KPI / chart blocks. Build a <strong>reference</strong> list
            by hand, or surface an app&apos;s <strong>responses</strong> as live data.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            {sources.length === 0 ? (
              <EmptyState
                icon={<Database size={32} />}
                title="No data sources"
                description="Create a reference list (e.g. Sites → Areas) or surface an app's responses as live data."
              />
            ) : (
              <ul className="space-y-3">
                {sources.map((s) => (
                  <li
                    key={s.id}
                    className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/admin/data-sources/${s.id}`} className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{s.name}</span>
                          <Badge variant={s.kind === 'responses' ? 'secondary' : 'outline'}>
                            {s.kind === 'responses' ? 'Live responses' : 'Reference'}
                          </Badge>
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
                            {s.key}
                          </code>
                        </div>
                        {s.description ? (
                          <p className="mt-1 text-sm text-slate-500">{s.description}</p>
                        ) : null}
                        <p className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <Table2 size={12} />
                            {(s.columns as DataSourceColumn[])?.length ?? 0} columns
                          </span>
                          {s.kind === 'reference' ? (
                            <span>{s.rowCount} rows</span>
                          ) : (
                            <span>live</span>
                          )}
                          <span className="inline-flex items-center gap-0.5 text-teal-600 opacity-0 transition group-hover:opacity-100">
                            Manage <ArrowUpRight size={12} />
                          </span>
                        </p>
                      </Link>
                      <form action={deleteDataSource}>
                        <input type="hidden" name="id" value={s.id} />
                        <button
                          type="submit"
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                          title="Delete data source"
                        >
                          <Trash2 size={15} />
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>New data source</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={createDataSource} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" name="name" required placeholder="e.g. Sites" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="kind">Kind</Label>
                    <Select id="kind" name="kind" defaultValue="reference">
                      <option value="reference">Reference list — curated rows</option>
                      <option value="responses">Live — an app&apos;s responses</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="templateId">Source app (for live)</Label>
                    <Select id="templateId" name="templateId" defaultValue="">
                      <option value="">—</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-slate-400">
                      Only used for the <em>Live</em> kind. Columns are snapshotted from the
                      app&apos;s fields.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description">Description</Label>
                    <Textarea id="description" name="description" rows={2} />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit">
                      <Plus size={14} /> Create
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How apps use these</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-600">
                <p>
                  In the app builder, add a <strong>Lookup</strong>, <strong>Data table</strong> or{' '}
                  <strong>KPI / chart</strong> element and bind it to a source here.
                </p>
                <p>
                  Cascading dropdowns (Site → Area → Sub-area) work by filtering one lookup&apos;s
                  rows by another field&apos;s value.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
