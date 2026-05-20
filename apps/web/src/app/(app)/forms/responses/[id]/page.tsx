import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { aliasedTable, asc, desc, eq } from 'drizzle-orm'
import { FileText, MessageSquare, Plus, Send, Undo2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Textarea,
} from '@beaconhs/ui'
import {
  formResponseComments,
  formResponseScores,
  formResponseSteps,
  formResponses,
  formTemplateVersions,
  formTemplates,
  orgUnits,
  people,
  tenantUsers,
  user,
  type FormWorkflowStep,
} from '@beaconhs/db/schema'
import {
  evaluateFormulaTree,
  evaluateLogicRule,
  type EvalContext,
  type FormulaExpression,
} from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { WorkflowPanel, type WorkflowStepProp } from './_workflow-panel'

export const dynamic = 'force-dynamic'

const TABS = ['response', 'comments', 'audit'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Form response · ${id.slice(0, 8)}` }
}

// ---------- Server actions ----------

async function addComment(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const responseId = String(formData.get('responseId') ?? '')
  const body = String(formData.get('body') ?? '').trim()
  if (!responseId || !body) return
  if (!ctx.membership?.id) return
  await ctx.db((tx) =>
    tx.insert(formResponseComments).values({
      tenantId: ctx.tenantId,
      responseId,
      authorTenantUserId: ctx.membership!.id,
      body,
    }),
  )
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: 'Comment added',
  })
  revalidatePath(`/forms/responses/${responseId}`)
}

async function reopenResponse(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const responseId = String(formData.get('responseId') ?? '')
  if (!responseId) return
  await ctx.db((tx) =>
    tx
      .update(formResponses)
      .set({ status: 'in_progress', closedAt: null })
      .where(eq(formResponses.id, responseId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: responseId,
    action: 'update',
    summary: 'Response reopened',
  })
  revalidatePath(`/forms/responses/${responseId}`)
}

async function openCorrectiveAction(formData: FormData) {
  'use server'
  const responseId = String(formData.get('responseId') ?? '')
  if (!responseId) return
  redirect(
    `/corrective-actions/new?sourceEntityType=form_response&sourceEntityId=${responseId}`,
  )
}

// ---------- Page ----------

export default async function FormResponsePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'response')

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
    // Aliased joins so we can attach signer + rejector display names to each
    // step row in a single query.
    const signerTu = aliasedTable(tenantUsers, 'signer_tu')
    const signerUser = aliasedTable(user, 'signer_user')
    const signerPerson = aliasedTable(people, 'signer_person')
    const rejectorTu = aliasedTable(tenantUsers, 'rejector_tu')
    const rejectorUser = aliasedTable(user, 'rejector_user')

    const [steps, comments, scoreRows] = await Promise.all([
      tx
        .select({
          step: formResponseSteps,
          signerTu,
          signerUser,
          signerPerson,
          rejectorTu,
          rejectorUser,
        })
        .from(formResponseSteps)
        .leftJoin(signerTu, eq(signerTu.id, formResponseSteps.signedByTenantUserId))
        .leftJoin(signerUser, eq(signerUser.id, signerTu.userId))
        .leftJoin(signerPerson, eq(signerPerson.id, formResponseSteps.signedByPersonId))
        .leftJoin(rejectorTu, eq(rejectorTu.id, formResponseSteps.rejectedByTenantUserId))
        .leftJoin(rejectorUser, eq(rejectorUser.id, rejectorTu.userId))
        .where(eq(formResponseSteps.responseId, id))
        .orderBy(asc(formResponseSteps.sequence)),
      tx
        .select({ comment: formResponseComments, author: tenantUsers, account: user })
        .from(formResponseComments)
        .leftJoin(tenantUsers, eq(tenantUsers.id, formResponseComments.authorTenantUserId))
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(formResponseComments.responseId, id))
        .orderBy(desc(formResponseComments.createdAt)),
      tx
        .select()
        .from(formResponseScores)
        .where(eq(formResponseScores.responseId, id)),
    ])
    return { ...row, steps, comments, scoreRows }
  })

  if (!data) notFound()
  const {
    response,
    template,
    version,
    site,
    subjectPerson,
    submitterAccount,
    steps,
    comments,
    scoreRows,
  } = data

  const failCount = scoreRows.filter((r) => r.score === 0).length
  const passCount = scoreRows.filter((r) => r.score === 1).length

  // Build the workflow-panel input by joining the template's declared steps
  // with whatever state rows already exist. Steps the user hasn't touched yet
  // contribute a `pending` placeholder so the panel can show "Step 3 of 5".
  const templateWorkflowSteps: FormWorkflowStep[] = version.schema.workflow?.steps ?? []
  const stepsByKey = new Map(steps.map((row) => [row.step.stepKey, row]))
  const workflowStepProps: WorkflowStepProp[] = templateWorkflowSteps.map((wf, i) => {
    const joined = stepsByKey.get(wf.key)
    const row = joined?.step ?? null
    const signedByName =
      joined?.signerUser?.name ??
      joined?.signerTu?.displayName ??
      (joined?.signerPerson
        ? `${joined.signerPerson.firstName} ${joined.signerPerson.lastName}`
        : null)
    const rejectedByName =
      joined?.rejectorUser?.name ?? joined?.rejectorTu?.displayName ?? null
    const assigneeLabel =
      wf.assignee.type === 'literal'
        ? wf.assignee.userId
        : wf.assignee.type === 'role'
          ? wf.assignee.role
          : wf.assignee.expr
    return {
      key: wf.key,
      sequence: i,
      title: wf.title?.en ?? wf.key,
      signatureRequired: !!wf.signatureRequired,
      assigneeKind: wf.assignee.type,
      assigneeLabel,
      status: (row?.status ?? 'pending') as WorkflowStepProp['status'],
      signedAt: row?.signedAt ? row.signedAt.toISOString() : null,
      signedBy: signedByName,
      signatureDataUrl: row?.signatureDataUrl ?? null,
      comment: row?.comment ?? null,
      rejectionReason: row?.rejectionReason ?? null,
      rejectedAt: row?.rejectedAt ? row.rejectedAt.toISOString() : null,
      rejectedBy: rejectedByName,
    }
  })

  // The form's schema may declare needs-follow-up logic in metadata.
  const schemaMeta = (version.schema as any)?.metadata ?? {}
  const flagsFollowup =
    !!schemaMeta.needsFollowUpOnFail && failCount > 0

  const supportsReopen = response.status === 'closed' || response.status === 'rejected'

  const activity =
    active === 'audit' ? await recentActivityForEntity(ctx, 'form_response', id, 100) : []

  const basePath = `/forms/responses/${id}`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/forms', label: 'Back to forms' }}
          title={template.name}
          subtitle={`${id.slice(0, 8)} · v${version.version}`}
          badge={
            <Badge
              variant={
                response.status === 'closed' || response.status === 'submitted'
                  ? 'success'
                  : response.status === 'rejected'
                    ? 'destructive'
                    : 'warning'
              }
            >
              {response.status.replace('_', ' ')}
            </Badge>
          }
          actions={
            <>
              {flagsFollowup ? (
                <form action={openCorrectiveAction} className="inline">
                  <input type="hidden" name="responseId" value={id} />
                  <Button type="submit">
                    <Plus size={14} /> Open corrective action
                  </Button>
                </form>
              ) : (
                <Link
                  href={`/corrective-actions/new?sourceEntityType=form_response&sourceEntityId=${id}`}
                >
                  <Button variant="outline">
                    <Plus size={14} /> Open corrective action
                  </Button>
                </Link>
              )}
              {supportsReopen ? (
                <form action={reopenResponse} className="inline">
                  <input type="hidden" name="responseId" value={id} />
                  <Button type="submit" variant="outline">
                    <Undo2 size={14} /> Reopen
                  </Button>
                </form>
              ) : null}
              <Link href={`/forms/responses/${id}/pdf`}>
                <Button variant="outline">
                  <FileText size={14} /> PDF
                </Button>
              </Link>
            </>
          }
        />
      }
      alerts={
        flagsFollowup ? (
          <Alert variant="warning">
            <AlertTitle>Follow-up required</AlertTitle>
            <AlertDescription>
              This response has {failCount} failing item{failCount === 1 ? '' : 's'} and the template
              is configured to require a corrective action.
            </AlertDescription>
          </Alert>
        ) : null
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'response', label: 'Response' },
            { key: 'comments', label: 'Comments', count: comments.length },
            { key: 'audit', label: 'Audit trail' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'response' ? (
          <>
            <Section title="Overview">
              <DetailGrid
                rows={[
                  {
                    label: 'Template',
                    value: (
                      <Link
                        href={`/forms/templates/${template.id}`}
                        className="text-teal-700 hover:underline"
                      >
                        {template.name}
                      </Link>
                    ),
                  },
                  { label: 'Template version', value: `v${version.version}` },
                  { label: 'Status', value: response.status.replace('_', ' ') },
                  { label: 'Current step', value: response.currentStep ?? '—' },
                  { label: 'Site', value: site?.name ?? '—' },
                  {
                    label: 'Subject',
                    value: subjectPerson
                      ? `${subjectPerson.firstName} ${subjectPerson.lastName}`
                      : '—',
                  },
                  { label: 'Submitted by', value: submitterAccount?.name ?? '—' },
                  {
                    label: 'Submitted at',
                    value: response.submittedAt
                      ? new Date(response.submittedAt).toLocaleString()
                      : '—',
                  },
                  {
                    label: 'Closed at',
                    value: response.closedAt ? new Date(response.closedAt).toLocaleString() : '—',
                  },
                ]}
              />
            </Section>

            {scoreRows.length > 0 ? (
              <Section title="Compliance scoring">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Badge variant="success">{passCount} pass</Badge>
                  <Badge variant="destructive">{failCount} fail</Badge>
                  <Badge variant="secondary">
                    {scoreRows.length - passCount - failCount} n/a or rating
                  </Badge>
                  <span className="text-slate-500">{scoreRows.length} scored items total</span>
                </div>
              </Section>
            ) : null}

            {(() => {
              // Build a shared eval context once for the entire response page.
              // Repeating-section row arrays are hoisted out of `data` into
              // `ctx.rows` so cross-section formulas (sum_section) resolve.
              const rows: Record<string, Array<Record<string, unknown>>> = {}
              for (const sec of version.schema.sections) {
                if (!sec.repeating) continue
                const v = response.data[sec.id]
                rows[sec.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
              }
              const evalCtx: EvalContext = { values: response.data, rows }
              return version.schema.sections.map((sec) => {
                // Section-level conditional visibility — skip entirely if false.
                if (sec.showIf && !evaluateLogicRule(sec.showIf, evalCtx)) return null
                return (
                  <Section
                    key={sec.id}
                    title={sec.title?.en ?? sec.id}
                    subtitle={sec.repeating ? 'repeating section' : undefined}
                  >
                    {sec.repeating
                      ? renderRepeating(sec, response.data, evalCtx)
                      : renderFlat(sec, response.data, evalCtx)}
                  </Section>
                )
              })
            })()}

            <Section
              title={`Workflow steps (${workflowStepProps.length})`}
              defaultOpen={workflowStepProps.length > 0}
            >
              {workflowStepProps.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No workflow steps configured on this template.
                </p>
              ) : (
                <WorkflowPanel
                  responseId={id}
                  steps={workflowStepProps}
                  currentStepKey={response.currentStep ?? null}
                  responseStatus={response.status}
                  // canAct = a user is signed in to this tenant. The panel itself
                  // disables interaction when the response is in a terminal
                  // (closed/rejected) state. Super-admin viewing-as has
                  // membership=null but ctx-level permissions; we still allow
                  // them to interact for cross-tenant debugging.
                  canAct={true}
                />
              )}
            </Section>
          </>
        ) : null}

        {active === 'comments' ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Comments ({comments.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {comments.length === 0 ? (
                  <EmptyState
                    icon={<MessageSquare size={24} />}
                    title="No comments yet"
                    description="Use comments for back-and-forth between reviewers and submitters, follow-up notes, or correction history."
                  />
                ) : (
                  <ul className="space-y-3 text-sm">
                    {comments.map((c) => (
                      <li
                        key={c.comment.id}
                        className="rounded-md border border-slate-200 bg-white p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {c.account?.name ?? c.author?.displayName ?? 'Someone'}
                          </span>
                          <span className="text-xs text-slate-500">
                            {new Date(c.comment.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-slate-800">{c.comment.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Section title="Add a comment">
              <form action={addComment} className="space-y-3">
                <input type="hidden" name="responseId" value={id} />
                <Textarea name="body" rows={3} required placeholder="Type a comment…" />
                <div className="flex justify-end">
                  <Button type="submit">
                    <Send size={14} /> Post comment
                  </Button>
                </div>
              </form>
            </Section>
          </div>
        ) : null}

        {active === 'audit' ? (
          <Card>
            <CardHeader>
              <CardTitle>Audit trail</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed entries={activity} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}

function renderFlat(
  sec: any,
  values: Record<string, unknown>,
  evalCtx: EvalContext,
) {
  if (sec.fields.length === 0) return <p className="text-sm text-slate-500">No fields.</p>
  const visible = sec.fields.filter((f: any) => !f.showIf || evaluateLogicRule(f.showIf, evalCtx))
  if (visible.length === 0) {
    return <p className="text-sm text-slate-500">All fields in this section are conditionally hidden.</p>
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {visible.map((f: any) => {
        // Formula fields show the recomputed value, not whatever was stored.
        let raw: unknown = values[f.id]
        if ((f.type === 'formula' || f.type === 'calc') && f.formula) {
          raw = evaluateFormulaTree(f.formula as FormulaExpression, evalCtx)
        }
        return (
          <div key={f.id} className="flex flex-col">
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              {f.label?.en ?? f.id}
            </dt>
            <dd className="text-slate-900">{renderValue(f.type, raw)}</dd>
          </div>
        )
      })}
    </dl>
  )
}

function renderRepeating(
  sec: any,
  values: Record<string, unknown>,
  evalCtx: EvalContext,
) {
  const rows = (values[sec.id] as Array<Record<string, unknown>> | undefined) ?? []
  if (rows.length === 0) return <p className="text-sm text-slate-500">No rows recorded.</p>
  return (
    <ul className="space-y-3">
      {rows.map((row, i) => {
        // Per-row eval context so showIf inside the row can reference siblings.
        const rowCtx: EvalContext = { ...evalCtx, values: { ...evalCtx.values, ...row } }
        return (
          <li key={i} className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Row {i + 1}</div>
            {renderFlat(sec, row, rowCtx)}
          </li>
        )
      })}
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
    case 'multi_person_picker':
      return Array.isArray(raw)
        ? raw.map((v) => String(v).slice(0, 8)).join(', ')
        : String(raw).slice(0, 8)
    case 'signature':
      return <span className="text-slate-500">[signature captured]</span>
    case 'photo':
    case 'photo_upload':
    case 'file':
    case 'video':
    case 'audio':
      return (
        <span className="text-slate-500">
          [{Array.isArray(raw) ? raw.length : 1} attachment]
        </span>
      )
    default:
      return String(raw)
  }
}
