// /admin/email-templates — tenant admins author reusable HTML emails in a
// drag-and-drop builder. Flows reference these from the send_email action
// (mode='template'). Gated by admin.settings.manage.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Mail, Plus, Trash2, ArrowUpRight } from 'lucide-react'
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
import { emailTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { createEmailTemplate, deleteEmailTemplate } from './_actions'

export const metadata = { title: 'Email templates' }
export const dynamic = 'force-dynamic'

export default async function EmailTemplatesPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const templates = await ctx.db((tx) =>
    tx
      .select({
        id: emailTemplates.id,
        key: emailTemplates.key,
        name: emailTemplates.name,
        category: emailTemplates.category,
        isActive: emailTemplates.isActive,
        updatedAt: emailTemplates.updatedAt,
      })
      .from(emailTemplates)
      .where(isNull(emailTemplates.deletedAt))
      .orderBy(asc(emailTemplates.name)),
  )

  return (
    <PageContainer>
      <div className="space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Mail size={22} className="text-teal-600" />
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Email templates
            </h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Reusable, branded emails built with a drag-and-drop editor. Flows send these from the{' '}
            <strong>Send email</strong> action — pick a template, or write the email inline. Use{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-slate-800">
              {'{{token}}'}
            </code>{' '}
            placeholders that fill in from the record when the flow runs.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            {templates.length === 0 ? (
              <EmptyState
                icon={<Mail size={32} />}
                title="No email templates"
                description="Create your first branded email, then send it from any flow's Send email action."
              />
            ) : (
              <ul className="space-y-3">
                {templates.map((t) => (
                  <li
                    key={t.id}
                    className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/admin/email-templates/${t.id}`} className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {t.name}
                          </span>
                          <Badge variant="outline">{t.category}</Badge>
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
                      <form action={deleteEmailTemplate}>
                        <input type="hidden" name="id" value={t.id} />
                        <button
                          type="submit"
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
                          title="Delete template"
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
                <CardTitle>New template</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={createEmailTemplate} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" name="name" required placeholder="e.g. Incident notification" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="category">Category</Label>
                    <Select id="category" name="category" defaultValue="notification">
                      <option value="general">General</option>
                      <option value="notification">Notification</option>
                      <option value="reminder">Reminder</option>
                      <option value="approval">Approval</option>
                      <option value="digest">Digest</option>
                      <option value="marketing">Marketing</option>
                    </Select>
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
