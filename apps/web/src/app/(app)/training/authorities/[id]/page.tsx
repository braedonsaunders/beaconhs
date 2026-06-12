import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, sql } from 'drizzle-orm'
import { Award, ListChecks } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import {
  trainingExtraFields,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule, requireModuleManage } from '@/lib/module-admin/guard'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { DetailPageLayout } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ActivityFeed } from '@/components/activity-feed'
import { ExtraFieldsSection } from '../../_components/extra-fields-section'
import { addExtraField, deleteExtraField } from '../../_lib/extra-fields-actions'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'skill_types', 'extras', 'activity'] as const
type Tab = (typeof TABS)[number]

async function addSkillType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const authorityId = String(formData.get('authorityId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const code = String(formData.get('code') ?? '').trim() || null
  const validForMonthsRaw = String(formData.get('validForMonths') ?? '').trim()
  const validForMonths = validForMonthsRaw ? Number(validForMonthsRaw) : null
  const description = String(formData.get('description') ?? '').trim() || null

  await ctx.db((tx) =>
    tx.insert(trainingSkillTypes).values({
      tenantId: ctx.tenantId,
      authorityId,
      name,
      code,
      validForMonths,
      description,
    }),
  )
  await recordAudit(ctx, {
    entityType: 'training_skill_authority',
    entityId: authorityId,
    action: 'update',
    summary: `Added skill type "${name}"`,
  })
  revalidatePath(`/training/authorities/${authorityId}`)
  revalidatePath('/training/skills')
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Authority · ${id.slice(0, 8)}` }
}

export default async function AuthorityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')

  const ctx = await requireModuleManage('training')
  const data = await ctx.db(async (tx) => {
    const [authority] = await tx
      .select()
      .from(trainingSkillAuthorities)
      .where(eq(trainingSkillAuthorities.id, id))
      .limit(1)
    if (!authority) return null
    const skillTypes = await tx
      .select({
        type: trainingSkillTypes,
        holderCount: sql<number>`count(${trainingSkillAssignments.id})`.mapWith(Number),
      })
      .from(trainingSkillTypes)
      .leftJoin(
        trainingSkillAssignments,
        eq(trainingSkillAssignments.skillTypeId, trainingSkillTypes.id),
      )
      .where(eq(trainingSkillTypes.authorityId, id))
      .groupBy(trainingSkillTypes.id)
      .orderBy(asc(trainingSkillTypes.name))
    const extras = await tx
      .select()
      .from(trainingExtraFields)
      .where(
        and(eq(trainingExtraFields.ownerType, 'authority'), eq(trainingExtraFields.ownerId, id)),
      )
      .orderBy(asc(trainingExtraFields.sortOrder), asc(trainingExtraFields.createdAt))
    return { authority, skillTypes, extras }
  })

  if (!data) notFound()
  const { authority, skillTypes, extras } = data
  const activity =
    active === 'activity'
      ? await recentActivityForEntity(ctx, 'training_skill_authority', id, 50)
      : []

  const basePath = `/training/authorities/${id}`
  const drawer = pickString(sp.drawer)
  const closeHref = `${basePath}${active === 'overview' ? '' : `?tab=${active}`}`

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/authorities', label: 'Back to authorities' }}
          title={authority.name}
          subtitle={
            [authority.code, authority.jurisdiction].filter(Boolean).join(' · ') || undefined
          }
          badge={authority.code ? <Badge variant="secondary">{authority.code}</Badge> : undefined}
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'skill_types', label: 'Skill types', count: skillTypes.length },
            { key: 'extras', label: 'Additional fields', count: extras.length },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      {active === 'overview' ? (
        <Card>
          <CardHeader>
            <CardTitle>Authority details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid
              rows={[
                { label: 'Name', value: authority.name },
                { label: 'Code', value: authority.code ?? '—' },
                { label: 'Jurisdiction', value: authority.jurisdiction ?? '—' },
                { label: 'Skill types', value: skillTypes.length },
                { label: 'Created', value: new Date(authority.createdAt).toLocaleString() },
              ]}
            />
            {authority.notes ? (
              <div className="mt-4">
                <div className="text-xs tracking-wide text-slate-500 uppercase">Notes</div>
                <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">{authority.notes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {active === 'skill_types' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Skill types ({skillTypes.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {skillTypes.length === 0 ? (
                <EmptyState
                  icon={<Award size={24} />}
                  title="No skill types"
                  description="Add the first skill type below."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Valid for</TableHead>
                      <TableHead>Holders</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skillTypes.map(({ type, holderCount }) => (
                      <TableRow key={type.id}>
                        <TableCell>
                          <Link
                            href={`/training/skills/types/${type.id}`}
                            className="font-medium text-slate-900 hover:underline"
                          >
                            {type.name}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-600">
                          {type.code ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-600">
                          {type.validForMonths ? `${type.validForMonths} months` : 'No expiry'}
                        </TableCell>
                        <TableCell className="text-slate-600 tabular-nums">{holderCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add skill type</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={addSkillType} className="space-y-3">
                <input type="hidden" name="authorityId" value={id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>
                      Name <span className="text-red-600">*</span>
                    </Label>
                    <Input name="name" required placeholder="e.g. Pressure Welding Certification" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Code</Label>
                    <Input name="code" placeholder="e.g. PWELD" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Valid for (months)</Label>
                    <Input
                      name="validForMonths"
                      type="number"
                      min={1}
                      placeholder="leave blank for no expiry"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-3">
                    <Label>Description</Label>
                    <Textarea name="description" rows={2} />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit">
                    <ListChecks size={14} /> Add skill type
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {active === 'extras' ? (
        <ExtraFieldsSection
          ownerType="authority"
          ownerId={id}
          rows={extras.map((e) => ({
            id: e.id,
            fieldKey: e.fieldKey,
            fieldValue: e.fieldValue,
          }))}
          drawerOpen={drawer === 'add-extra-field'}
          drawerCloseHref={closeHref}
          addHref={`${basePath}?tab=extras&drawer=add-extra-field`}
          addAction={addExtraField}
          deleteAction={deleteExtraField}
        />
      ) : null}

      {active === 'activity' ? (
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed entries={activity} />
          </CardContent>
        </Card>
      ) : null}
    </DetailPageLayout>
  )
}
