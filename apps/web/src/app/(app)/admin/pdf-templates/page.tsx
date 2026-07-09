// /admin/pdf-templates — tenant admins author paper-size PDF DOCUMENTS in a
// drag-and-drop builder with a Paged.js page preview. Flows ATTACH these from
// the send_email action (separate from the email body). Gated admin.settings.manage.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileText, ArrowUpRight } from 'lucide-react'
import { asc, isNull } from 'drizzle-orm'
import { Badge, EmptyState, cn } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { pdfTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { listSubjectOptions } from '@/lib/flows/subject-fields'
import { listAppPdfTemplates, listModulePdfDefaults } from '@/lib/module-pdf'
import { PageContainer } from '@/components/page-layout'
import { AdminBackLink } from '../_back-link'
import { deletePdfTemplate } from './_actions'
import { AppTemplatesPanel } from './_app-templates.client'
import { DeletePdfTemplateButton } from './_delete-button'
import { ModuleDefaultsPanel } from './_module-defaults.client'
import { NewPdfTemplateFlyout } from './_new-template-flyout.client'

export const metadata = { title: 'PDF templates' }
export const dynamic = 'force-dynamic'

export default async function PdfTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const tab = (await searchParams).tab === 'defaults' ? 'defaults' : 'templates'

  const [templates, subjects, moduleDefaults, appTemplates] = await Promise.all([
    ctx.db((tx) =>
      tx
        .select({
          id: pdfTemplates.id,
          key: pdfTemplates.key,
          name: pdfTemplates.name,
          paperSize: pdfTemplates.paperSize,
          orientation: pdfTemplates.orientation,
          isActive: pdfTemplates.isActive,
          updatedAt: pdfTemplates.updatedAt,
        })
        .from(pdfTemplates)
        .where(isNull(pdfTemplates.deletedAt))
        .orderBy(asc(pdfTemplates.name)),
    ),
    listSubjectOptions(ctx),
    listModulePdfDefaults(ctx),
    listAppPdfTemplates(ctx),
  ])

  // Documents are hand-authored in the editor, so a PDF template makes no sense
  // for them — keep them out of the record-type picker.
  const moduleOptions = subjects.modules.filter((s) => s.key !== 'documents')

  return (
    <PageContainer>
      <AdminBackLink />
      <div className="space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileText size={22} className="text-teal-600" />
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                PDF templates
              </h1>
            </div>
            <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              Paper-size documents built with a drag-and-drop editor and a live page preview. Flows
              attach these as a PDF from the <strong>Send email</strong> action, and modules can use
              one as their default print layout. Use{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-slate-800">
                {'{{token}}'}
              </code>{' '}
              placeholders + record tables that fill in per record.
            </p>
          </div>
          <NewPdfTemplateFlyout modules={moduleOptions} apps={subjects.apps} />
        </header>

        <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
          <TabLink href="/admin/pdf-templates" active={tab === 'templates'}>
            Templates
          </TabLink>
          <TabLink href="/admin/pdf-templates?tab=defaults" active={tab === 'defaults'}>
            Module print defaults
          </TabLink>
        </nav>

        {tab === 'defaults' ? (
          <div className="space-y-10">
            <section className="space-y-4">
              <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                Choose which template each module&apos;s print/PDF button renders. Leave a module on{' '}
                <strong>Field summary</strong> to print a plain key/value document. Only templates
                whose record type matches the module are listed.
              </p>
              <ModuleDefaultsPanel rows={moduleDefaults} />
            </section>
            <section className="space-y-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Builder apps
              </h2>
              <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                Each published app can print its records with its own template. Publishing an app
                generates one automatically; use <strong>Generate default template</strong> for apps
                published before this existed or after their template was deleted.
              </p>
              <AppTemplatesPanel rows={appTemplates} />
            </section>
          </div>
        ) : templates.length === 0 ? (
          <EmptyState
            icon={<FileText size={32} />}
            title="No PDF templates"
            description="Create your first paper-size document, then attach it from any flow's Send email action or set it as a module's default print layout."
          />
        ) : (
          <ul className="space-y-3">
            {templates.map((t) => (
              <li
                key={t.id}
                className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/admin/pdf-templates/${t.id}`} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {t.name}
                      </span>
                      <Badge variant="outline">
                        {t.paperSize.toUpperCase()} · {t.orientation}
                      </Badge>
                      {!t.isActive ? <Badge variant="secondary">Inactive</Badge> : null}
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {t.key}
                      </code>
                    </div>
                    <p className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
                      <span>Updated {new Date(t.updatedAt).toLocaleDateString()}</span>
                      <span className="inline-flex items-center gap-0.5 text-teal-600 opacity-0 transition group-hover:opacity-100">
                        Edit <ArrowUpRight size={12} />
                      </span>
                    </p>
                  </Link>
                  <form action={deletePdfTemplate}>
                    <input type="hidden" name="id" value={t.id} />
                    <DeletePdfTemplateButton name={t.name} />
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  )
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition',
        active
          ? 'border-teal-600 text-teal-700 dark:text-teal-400'
          : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
      )}
    >
      {children}
    </Link>
  )
}
