import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { FileText } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
} from '@beaconhs/ui'
import {
  formResponseSteps,
  formResponses,
  formTemplateVersions,
  formTemplates,
  orgUnits,
  people,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Form response · ${id.slice(0, 8)}` }
}

export default async function FormResponsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        response: formResponses,
        template: formTemplates,
        version: formTemplateVersions,
        site: orgUnits,
        subjectPerson: people,
        submitterMembership: tenantUsers,
        submitterAccount: user,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .leftJoin(people, eq(people.id, formResponses.subjectPersonId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, formResponses.submittedBy))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(formResponses.id, id))
      .limit(1)
    if (!row) return null
    const steps = await tx
      .select()
      .from(formResponseSteps)
      .where(eq(formResponseSteps.responseId, id))
      .orderBy(asc(formResponseSteps.sequence))
    return { ...row, steps }
  })

  if (!data) notFound()
  const { response, template, version, site, subjectPerson, submitterAccount, steps } = data

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/forms', label: 'Back to forms' }}
          title={template.name}
          subtitle={`${id.slice(0, 8)} · v${version.version}`}
          badge={
            <Badge variant={response.status === 'closed' || response.status === 'submitted' ? 'success' : 'warning'}>
              {response.status.replace('_', ' ')}
            </Badge>
          }
          actions={
            <Link href={`/forms/responses/${id}/pdf`}>
              <Button variant="outline">
                <FileText size={14} /> PDF
              </Button>
            </Link>
          }
        />

        <Section title="Overview">
          <DetailGrid
            rows={[
              {
                label: 'Template',
                value: (
                  <Link href={`/forms/templates/${template.id}`} className="text-teal-700 hover:underline">
                    {template.name}
                  </Link>
                ),
              },
              { label: 'Template version', value: `v${version.version}` },
              { label: 'Status', value: response.status.replace('_', ' ') },
              { label: 'Current step', value: response.currentStep ?? '—' },
              { label: 'Site', value: site?.name ?? '—' },
              { label: 'Subject', value: subjectPerson ? `${subjectPerson.firstName} ${subjectPerson.lastName}` : '—' },
              { label: 'Submitted by', value: submitterAccount?.name ?? '—' },
              { label: 'Submitted at', value: response.submittedAt ? new Date(response.submittedAt).toLocaleString() : '—' },
              { label: 'Closed at', value: response.closedAt ? new Date(response.closedAt).toLocaleString() : '—' },
            ]}
          />
        </Section>

        {version.schema.sections.map((sec) => (
          <Section key={sec.id} title={sec.title?.en ?? sec.id} subtitle={sec.repeating ? 'repeating section' : undefined}>
            {sec.repeating ? renderRepeating(sec, response.data) : renderFlat(sec, response.data)}
          </Section>
        ))}

        <Section title={`Workflow steps (${steps.length})`} defaultOpen={steps.length > 0}>
          {steps.length === 0 ? (
            <p className="text-sm text-slate-500">No steps recorded for this response.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {steps.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2">
                  <div>
                    <div className="font-medium">{s.stepKey}</div>
                    <div className="text-xs text-slate-500">
                      {s.signedAt ? `signed ${new Date(s.signedAt).toLocaleString()}` : 'awaiting signature'}
                    </div>
                  </div>
                  <Badge variant={s.signedAt ? 'success' : 'warning'}>{s.signedAt ? 'signed' : 'open'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </PageContainer>
  )
}

function renderFlat(sec: any, values: Record<string, unknown>) {
  if (sec.fields.length === 0) return <p className="text-sm text-slate-500">No fields.</p>
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {sec.fields.map((f: any) => (
        <div key={f.id} className="flex flex-col">
          <dt className="text-xs uppercase tracking-wide text-slate-500">{f.label?.en ?? f.id}</dt>
          <dd className="text-slate-900">{renderValue(f.type, values[f.id])}</dd>
        </div>
      ))}
    </dl>
  )
}

function renderRepeating(sec: any, values: Record<string, unknown>) {
  const rows = (values[sec.id] as Array<Record<string, unknown>> | undefined) ?? []
  if (rows.length === 0) return <p className="text-sm text-slate-500">No rows recorded.</p>
  return (
    <ul className="space-y-3">
      {rows.map((row, i) => (
        <li key={i} className="rounded-md border border-slate-200 p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Row {i + 1}</div>
          {renderFlat(sec, row)}
        </li>
      ))}
    </ul>
  )
}

function renderValue(type: string, raw: unknown) {
  if (raw === undefined || raw === null || raw === '') {
    return <span className="text-slate-400">—</span>
  }
  switch (type) {
    case 'yes_no_comment': {
      const v = raw as { answer?: string; comment?: string }
      return (
        <span>
          <strong>{v.answer ?? '—'}</strong>
          {v.comment ? <span className="ml-2 text-slate-500">— {v.comment}</span> : null}
        </span>
      )
    }
    case 'checkbox_group':
    case 'multi_select':
    case 'person_picker':
      return Array.isArray(raw)
        ? raw.map((v) => String(v).slice(0, 8)).join(', ')
        : String(raw).slice(0, 8)
    case 'signature':
      return <span className="text-slate-500">[signature captured]</span>
    case 'photo':
    case 'file':
    case 'video':
    case 'audio':
      return <span className="text-slate-500">[{Array.isArray(raw) ? raw.length : 1} attachment]</span>
    default:
      return String(raw)
  }
}
