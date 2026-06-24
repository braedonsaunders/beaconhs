// /admin/pdf-templates — tenant admins author paper-size PDF DOCUMENTS in a
// drag-and-drop builder with a Paged.js page preview. Flows ATTACH these from
// the send_email action (separate from the email body). Gated admin.settings.manage.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileText, Plus, ArrowUpRight } from 'lucide-react'
import { asc, isNull } from 'drizzle-orm'
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
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { pdfTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { listSubjectOptions } from '@/lib/flows/subject-fields'
import { PageContainer } from '@/components/page-layout'
import { AdminBackLink } from '../_back-link'
import { createPdfTemplate, deletePdfTemplate } from './_actions'
import { DeletePdfTemplateButton } from './_delete-button'

export const metadata = { title: 'PDF templates' }
export const dynamic = 'force-dynamic'

export default async function PdfTemplatesPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const [templates, subjects] = await Promise.all([
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
  ])

  return (
    <PageContainer>
      <AdminBackLink />
      <div className="space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText size={22} className="text-teal-600" />
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              PDF templates
            </h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Paper-size documents built with a drag-and-drop editor and a live page preview. Flows
            attach these as a PDF from the <strong>Send email</strong> action. Use{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-slate-800">
              {'{{token}}'}
            </code>{' '}
            placeholders + record tables that fill in when the flow runs.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            {templates.length === 0 ? (
              <EmptyState
                icon={<FileText size={32} />}
                title="No PDF templates"
                description="Create your first paper-size document, then attach it from any flow's Send email action."
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

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>New PDF template</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={createPdfTemplate} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" name="name" required placeholder="e.g. Incident report" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="recordSubject">Record type *</Label>
                    <Select id="recordSubject" name="recordSubject" required defaultValue="">
                      <option value="" disabled>
                        Choose a record type…
                      </option>
                      <optgroup label="Native modules">
                        {subjects.modules.map((s) => (
                          <option key={`module:${s.key}`} value={`module:${s.key}`}>
                            {s.label}
                          </option>
                        ))}
                      </optgroup>
                      {subjects.apps.length > 0 ? (
                        <optgroup label="Builder apps">
                          {subjects.apps.map((s) => (
                            <option key={`form_template:${s.key}`} value={`form_template:${s.key}`}>
                              {s.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="paperSize">Paper</Label>
                      <Select id="paperSize" name="paperSize" defaultValue="letter">
                        <option value="letter">Letter</option>
                        <option value="a4">A4</option>
                        <option value="legal">Legal</option>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="orientation">Orientation</Label>
                      <Select id="orientation" name="orientation" defaultValue="portrait">
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </Select>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit">
                      <Plus size={14} /> Create
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
