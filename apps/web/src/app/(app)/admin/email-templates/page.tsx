import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
// /admin/email-templates — tenant admins author reusable HTML emails in a
// drag-and-drop builder. Flows reference these from the send_email action
// (mode='template'). Gated by admin.settings.manage.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Mail, Plus, ArrowUpRight } from 'lucide-react'
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
import { formatDate } from '@/lib/datetime'
import { listSubjectOptions } from '@/lib/flows/subject-fields'
import { PageContainer } from '@/components/page-layout'
import { NotificationsSubNav } from '@/components/notifications-sub-nav'
import { AdminBackLink } from '../_back-link'
import { createEmailTemplate, deleteEmailTemplate } from './_actions'
import { DeleteTemplateButton } from './_delete-button'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1b74060f6a1969') }
}
export const dynamic = 'force-dynamic'

export default async function EmailTemplatesPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const [templates, subjects] = await Promise.all([
    ctx.db((tx) =>
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
    ),
    listSubjectOptions(ctx),
  ])

  return (
    <PageContainer>
      <AdminBackLink />
      <div className="mt-3">
        <NotificationsSubNav active="templates" showBack={false} />
      </div>
      <div className="space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Mail size={22} className="text-teal-600" />
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedText id="m_1b74060f6a1969" />
            </h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_14a55727ce9ac5" />
            <GeneratedValue value={' '} />
            <strong>
              <GeneratedText id="m_09dfca28fc95ba" />
            </strong>{' '}
            <GeneratedText id="m_020c00659dc939" />
            <GeneratedValue value={' '} />
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-slate-800">
              {'{{token}}'}
            </code>
            <GeneratedValue value={' '} />
            <GeneratedText id="m_07103097473b81" />
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            <GeneratedValue
              value={
                templates.length === 0 ? (
                  <EmptyState
                    icon={<Mail size={32} />}
                    title={tGenerated('m_09d0f08a5dc7dd')}
                    description={tGenerated('m_026ba97e8186e3')}
                  />
                ) : (
                  <ul className="space-y-3">
                    <GeneratedValue
                      value={templates.map((t) => (
                        <li
                          key={t.id}
                          className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <Link
                              href={`/admin/email-templates/${t.id}`}
                              className="min-w-0 flex-1"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                  <GeneratedValue value={t.name} />
                                </span>
                                <Badge variant="outline">
                                  <GeneratedValue value={t.category} />
                                </Badge>
                                <GeneratedValue
                                  value={
                                    !t.isActive ? (
                                      <Badge variant="secondary">
                                        <GeneratedText id="m_0f47ea07c99dba" />
                                      </Badge>
                                    ) : null
                                  }
                                />
                                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                  {t.key}
                                </code>
                              </div>
                              <p className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
                                <span>
                                  <GeneratedText id="m_014ca61c68ab13" />{' '}
                                  <GeneratedValue
                                    value={formatDate(
                                      new Date(t.updatedAt),
                                      ctx.timezone,
                                      ctx.locale,
                                    )}
                                  />
                                </span>
                                <span className="inline-flex items-center gap-0.5 text-teal-600 opacity-0 transition group-hover:opacity-100">
                                  <GeneratedText id="m_03a66f9d34ac7b" /> <ArrowUpRight size={12} />
                                </span>
                              </p>
                            </Link>
                            <form action={deleteEmailTemplate}>
                              <input type="hidden" name="id" value={t.id} />
                              <DeleteTemplateButton name={t.name} />
                            </form>
                          </div>
                        </li>
                      ))}
                    />
                  </ul>
                )
              }
            />
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <GeneratedText id="m_029927b6de38e7" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={createEmailTemplate} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">
                      <GeneratedText id="m_1a9978900838e6" />
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      required
                      maxLength={200}
                      placeholder={tGenerated('m_168c7270870b8b')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="recordSubject">
                      <GeneratedText id="m_0f9634263f05a3" />
                    </Label>
                    <Select id="recordSubject" name="recordSubject" required defaultValue="">
                      <option value="" disabled>
                        {'Choose a record type…'}
                      </option>
                      <optgroup label={tGenerated('m_1e649a5a75a0e0')}>
                        {subjects.modules.map((s) => (
                          <option key={`module:${s.key}`} value={`module:${s.key}`}>
                            {s.label}
                          </option>
                        ))}
                      </optgroup>
                      {subjects.apps.length > 0 ? (
                        <optgroup label={tGenerated('m_0c770d55914bfa')}>
                          {subjects.apps.map((s) => (
                            <option key={`form_template:${s.key}`} value={`form_template:${s.key}`}>
                              {s.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </Select>
                    <p className="text-[11px] text-slate-400">
                      <GeneratedText id="m_01d1bbc9241d07" />
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="category">
                      <GeneratedText id="m_108b41637f364f" />
                    </Label>
                    <Select id="category" name="category" defaultValue="notification">
                      <option value="general">{'General'}</option>
                      <option value="notification">{'Notification'}</option>
                      <option value="reminder">{'Reminder'}</option>
                      <option value="approval">{'Approval'}</option>
                      <option value="digest">{'Digest'}</option>
                      <option value="marketing">{'Marketing'}</option>
                    </Select>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit">
                      <Plus size={14} /> <GeneratedText id="m_017309f0f9f564" />
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
