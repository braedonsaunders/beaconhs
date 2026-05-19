import Link from 'next/link'
import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { ClipboardCheck, FileCode } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
} from '@beaconhs/ui'
import {
  formAssignments,
  formResponses,
  formTemplateVersions,
  formTemplates,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'

export const dynamic = 'force-dynamic'

const FORM_TABS = ['overview', 'schema', 'assignments', 'responses', 'raw'] as const
type FormTab = (typeof FORM_TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Form template · ${id.slice(0, 8)}` }
}

export default async function FormTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: FormTab = pickActiveTab(sp, FORM_TABS, 'overview')
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [tmpl] = await tx.select().from(formTemplates).where(eq(formTemplates.id, id)).limit(1)
    if (!tmpl) return null
    const [versions, assignments, recent] = await Promise.all([
      tx
        .select()
        .from(formTemplateVersions)
        .where(eq(formTemplateVersions.templateId, id))
        .orderBy(desc(formTemplateVersions.version)),
      tx.select().from(formAssignments).where(eq(formAssignments.templateId, id)),
      tx
        .select()
        .from(formResponses)
        .where(eq(formResponses.templateId, id))
        .orderBy(desc(formResponses.createdAt))
        .limit(10),
    ])
    return { tmpl, versions, assignments, recent }
  })
  if (!data) notFound()
  const { tmpl, versions, assignments, recent } = data
  const current = versions[0]
  const totalFields = current
    ? current.schema.sections.reduce((acc, s) => acc + s.fields.length, 0)
    : 0

  const basePath = `/forms/templates/${id}`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/forms', label: 'Back to forms' }}
          title={tmpl.name}
          subtitle={`Key: ${tmpl.key} · ${tmpl.category ?? 'custom'}`}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={tmpl.status === 'published' ? 'success' : 'secondary'}>{tmpl.status}</Badge>
              {current ? <Badge variant="outline">v{current.version}</Badge> : null}
            </div>
          }
          actions={
            <>
              <Link href={`/forms/templates/${tmpl.id}/designer`}>
                <Button>Edit schema</Button>
              </Link>
              <Link href={`/forms/templates/${tmpl.id}/fill`}>
                <Button variant="outline">Fill out</Button>
              </Link>
            </>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'schema', label: 'Schema', count: totalFields },
            { key: 'assignments', label: 'Assignments', count: assignments.length },
            { key: 'responses', label: 'Recent responses', count: recent.length },
            { key: 'raw', label: 'Raw JSON' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
        <Section title="Overview">
          <DetailGrid
            rows={[
              { label: 'Name', value: tmpl.name },
              { label: 'Key', value: <span className="font-mono">{tmpl.key}</span> },
              { label: 'Category', value: tmpl.category ?? '—' },
              { label: 'Status', value: tmpl.status },
              { label: 'Module binding', value: tmpl.moduleBinding ?? '—' },
              { label: 'Sections', value: current?.schema.sections.length ?? 0 },
              { label: 'Fields', value: totalFields },
            ]}
          />
          {tmpl.description ? (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Description</div>
              <p className="mt-1 text-sm text-slate-700">{tmpl.description}</p>
            </div>
          ) : null}
        </Section>
        ) : null}

        {active === 'schema' && current ? (
          <Section title={`Schema (v${current.version})`} subtitle="Sections + fields the renderer will display">
            <ul className="space-y-3">
              {current.schema.sections.map((sec) => (
                <li key={sec.id} className="rounded-md border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                    <div>
                      <div className="text-sm font-semibold">
                        {sec.title?.en ?? sec.id} {sec.repeating ? <Badge variant="secondary">repeating</Badge> : null}
                      </div>
                      <div className="text-xs text-slate-500">{sec.fields.length} fields</div>
                    </div>
                  </div>
                  <ul className="divide-y divide-slate-100 px-4 py-2 text-sm">
                    {sec.fields.map((f) => (
                      <li key={f.id} className="flex items-center justify-between py-1.5">
                        <span>
                          <span className="font-medium">{f.label?.en ?? f.id}</span>
                          {f.required ? <span className="text-red-600"> *</span> : null}
                          <span className="ml-2 text-xs text-slate-500">{f.type}</span>
                        </span>
                        {f.showIf ? <Badge variant="secondary">conditional</Badge> : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {active === 'assignments' ? (
        <Section title={`Assignments (${assignments.length})`}>
          {assignments.length === 0 ? (
            <p className="text-sm text-slate-500">No assignments configured.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium">{a.mode.replace('_', ' ')}</div>
                    <div className="text-xs text-slate-500">
                      {a.mode === 'scheduled' ? `cron: ${a.cron ?? '—'}` : ''}
                      {a.targetRoleKeys?.length ? ` · roles: ${a.targetRoleKeys.join(', ')}` : ''}
                    </div>
                  </div>
                  <Badge variant={a.enabled ? 'success' : 'secondary'}>{a.enabled ? 'enabled' : 'disabled'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
        ) : null}

        {active === 'responses' ? (
        <Section title={`Recent responses (${recent.length})`}>
          {recent.length === 0 ? (
            <EmptyState icon={<ClipboardCheck size={24} />} title="No responses yet" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <Link href={`/forms/responses/${r.id}`} className="font-mono text-xs hover:underline">
                    {r.id.slice(0, 8)}
                  </Link>
                  <Badge variant={r.status === 'closed' || r.status === 'submitted' ? 'success' : 'warning'}>
                    {r.status.replace('_', ' ')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
        ) : null}

        {active === 'raw' ? (
        <Section title="Raw schema (debug)">
          <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-700">
            {JSON.stringify(current?.schema, null, 2)}
          </pre>
        </Section>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}
