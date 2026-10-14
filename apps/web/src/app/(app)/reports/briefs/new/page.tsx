import { redirect } from 'next/navigation'
import { CalendarClock, FileText, Sparkles } from 'lucide-react'
import { DetailHeader } from '@beaconhs/ui'
import { BRIEF_TEMPLATES, getBriefSource } from '@beaconhs/briefs'
import { PageContainer } from '@/components/page-layout'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { canManageBriefs } from '@/lib/briefs/access'
import { CreateBriefButton } from './_create-button'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0a24326f168c54') }
}

export default async function NewBriefPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!canManageBriefs(ctx)) redirect('/reports/briefs')
  const templates = BRIEF_TEMPLATES.filter((template) =>
    template.spec.sources.every((s) => getBriefSource(s.key)?.canRead(ctx)),
  )
  return (
    <PageContainer className="space-y-5">
      <DetailHeader
        back={{ href: '/reports/briefs', label: tGenerated('m_1fcc120127ae49') }}
        title={tGenerated('m_0a24326f168c54')}
        subtitle={tGenerated('m_16ee1454d783ce')}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <div
            key={template.key}
            className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center gap-2 text-teal-700 dark:text-teal-300">
              <Sparkles size={16} />
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedValue value={template.name} />
              </h2>
            </div>
            <p className="mt-2 flex-1 text-sm text-slate-600 dark:text-slate-300">
              <GeneratedValue value={template.description} />
            </p>
            <dl className="mt-3 space-y-1 text-xs text-slate-500">
              <div className="flex items-start gap-1.5">
                <FileText size={12} className="mt-0.5 shrink-0" />
                <GeneratedValue
                  value={template.spec.sources
                    .map((s) => getBriefSource(s.key)?.label ?? s.key)
                    .join(', ')}
                />
              </div>
              <div className="flex items-start gap-1.5">
                <CalendarClock size={12} className="mt-0.5 shrink-0" />
                <GeneratedValue value={template.spec.sections.map((s) => s.title).join(' · ')} />
              </div>
            </dl>
            <div className="mt-4">
              <CreateBriefButton
                templateKey={template.key}
                label={tGenerated('m_174056f98b4abb')}
              />
            </div>
          </div>
        ))}
        <div className="flex flex-col justify-between rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedText id="m_0f886d665d675a" />
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              <GeneratedText id="m_07a77fe76f8844" />
            </p>
          </div>
          <div className="mt-4">
            <CreateBriefButton
              templateKey={null}
              label={tGenerated('m_1f809c4de18128')}
              variant="outline"
            />
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
