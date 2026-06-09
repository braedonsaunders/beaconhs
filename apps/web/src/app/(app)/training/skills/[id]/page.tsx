import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'
import { Users } from 'lucide-react'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  people,
  trainingExtraFields,
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { pickString } from '@/lib/list-params'
import { DetailPageLayout } from '@/components/page-layout'
import { DetailGrid } from '@/components/detail-grid'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ExtraFieldsSection } from '../../_components/extra-fields-section'
import { addExtraField, deleteExtraField } from '../../_lib/extra-fields-actions'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'holders', 'extras'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Skill · ${id.slice(0, 8)}` }
}

export default async function SkillTypeDetailPage({
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
    const [row] = await tx
      .select({ type: trainingSkillTypes, authority: trainingSkillAuthorities })
      .from(trainingSkillTypes)
      .innerJoin(
        trainingSkillAuthorities,
        eq(trainingSkillAuthorities.id, trainingSkillTypes.authorityId),
      )
      .where(eq(trainingSkillTypes.id, id))
      .limit(1)
    if (!row) return null
    const holders = await tx
      .select({ assignment: trainingSkillAssignments, person: people })
      .from(trainingSkillAssignments)
      .innerJoin(people, eq(people.id, trainingSkillAssignments.personId))
      .where(eq(trainingSkillAssignments.skillTypeId, id))
      .orderBy(asc(trainingSkillAssignments.expiresOn))
    const extras = await tx
      .select()
      .from(trainingExtraFields)
      .where(
        and(
          eq(trainingExtraFields.ownerType, 'skill_type'),
          eq(trainingExtraFields.ownerId, id),
        ),
      )
      .orderBy(asc(trainingExtraFields.sortOrder), asc(trainingExtraFields.createdAt))
    return { ...row, holders, extras }
  })

  if (!data) notFound()
  const { type, authority, holders, extras } = data
  const drawer = pickString(sp.drawer)
  const closeHref = `${`/training/skills/${id}`}${active === 'overview' ? '' : `?tab=${active}`}`

  const today = new Date()
  const holdersWithStatus = holders.map((h) => {
    const exp = h.assignment.expiresOn ? new Date(h.assignment.expiresOn) : null
    const daysLeft = exp ? Math.round((exp.getTime() - today.getTime()) / 86_400_000) : null
    const status: 'valid' | 'expiring' | 'expired' | 'no_expiry' =
      daysLeft === null
        ? 'no_expiry'
        : daysLeft < 0
          ? 'expired'
          : daysLeft <= 30
            ? 'expiring'
            : 'valid'
    return { ...h, daysLeft, status }
  })

  const expiredCount = holdersWithStatus.filter((h) => h.status === 'expired').length
  const expiringCount = holdersWithStatus.filter((h) => h.status === 'expiring').length

  const basePath = `/training/skills/${id}`

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/skills', label: 'Back to skills' }}
          title={type.name}
          subtitle={`${authority.name}${type.code ? ` · ${type.code}` : ''}`}
          badge={
            type.validForMonths ? (
              <Badge variant="secondary">{type.validForMonths} months</Badge>
            ) : (
              <Badge variant="secondary">No expiry</Badge>
            )
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
            { key: 'holders', label: 'Holders', count: holders.length },
            { key: 'extras', label: 'Additional fields', count: extras.length },
          ]}
        />
      }
    >
      {active === 'overview' ? (
        <Card>
          <CardHeader>
            <CardTitle>Skill details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailGrid
              rows={[
                { label: 'Name', value: type.name },
                {
                  label: 'Authority',
                  value: (
                    <Link
                      href={`/training/authorities/${authority.id}`}
                      className="text-teal-700 hover:underline"
                    >
                      {authority.name}
                    </Link>
                  ),
                },
                { label: 'Code', value: type.code ?? '—' },
                {
                  label: 'Valid for',
                  value: type.validForMonths ? `${type.validForMonths} months` : 'No expiry',
                },
                { label: 'Holders', value: holders.length },
                {
                  label: 'Expiring (30d)',
                  value: expiringCount > 0 ? (
                    <Badge variant="warning">{expiringCount}</Badge>
                  ) : (
                    '0'
                  ),
                },
                {
                  label: 'Expired',
                  value: expiredCount > 0 ? (
                    <Badge variant="destructive">{expiredCount}</Badge>
                  ) : (
                    '0'
                  ),
                },
              ]}
            />
            {type.description ? (
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Description</div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{type.description}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {active === 'extras' ? (
        <ExtraFieldsSection
          ownerType="skill_type"
          ownerId={id}
          rows={extras.map((e) => ({
            id: e.id,
            fieldKey: e.fieldKey,
            fieldValue: e.fieldValue,
          }))}
          drawerOpen={drawer === 'add-extra-field'}
          drawerCloseHref={closeHref}
          addHref={`/training/skills/${id}?tab=extras&drawer=add-extra-field`}
          addAction={addExtraField}
          deleteAction={deleteExtraField}
        />
      ) : null}

      {active === 'holders' ? (
        <Card>
          <CardHeader>
            <CardTitle>Holders ({holders.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {holdersWithStatus.length === 0 ? (
              <EmptyState
                icon={<Users size={24} />}
                title="No holders yet"
                description="Assign this skill to a person from their profile."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Granted</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdersWithStatus.map((h) => (
                    <TableRow key={h.assignment.id}>
                      <TableCell>
                        <Link
                          href={`/people/${h.person.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {h.person.lastName}, {h.person.firstName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600">{h.assignment.grantedOn}</TableCell>
                      <TableCell className="text-slate-600">
                        {h.assignment.expiresOn ?? '—'}
                      </TableCell>
                      <TableCell>
                        {h.status === 'expired' ? (
                          <Badge variant="destructive">Expired {Math.abs(h.daysLeft!)}d ago</Badge>
                        ) : h.status === 'expiring' ? (
                          <Badge variant="warning">{h.daysLeft}d left</Badge>
                        ) : h.status === 'valid' ? (
                          <Badge variant="success">Valid</Badge>
                        ) : (
                          <Badge variant="secondary">No expiry</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </DetailPageLayout>
  )
}
