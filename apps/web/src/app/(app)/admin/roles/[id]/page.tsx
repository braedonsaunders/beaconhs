import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Textarea,
} from '@beaconhs/ui'
import { roleAssignments, roles, tenantUsers, user } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { ConfirmButton } from '../../users/_components/confirm-button'
import { PermissionMatrix } from '../_components/permission-matrix'
import { deleteRole, duplicateRole, updateRole } from '../_actions'

export const metadata = { title: 'Role' }
export const dynamic = 'force-dynamic'

export default async function AdminRoleEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.roles.manage')) redirect('/admin')
  const { id } = await params
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined

  const data = await ctx.db(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1)
    if (!role) return null
    const members = await tx
      .select({
        membershipId: tenantUsers.id,
        name: user.name,
        displayName: tenantUsers.displayName,
      })
      .from(roleAssignments)
      .innerJoin(tenantUsers, eq(tenantUsers.id, roleAssignments.tenantUserId))
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(roleAssignments.roleId, id))
      .orderBy(asc(user.name))
    return { role, members }
  })
  if (!data) notFound()
  const { role, members } = data

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin/roles', label: 'Back to roles' }}
          title={role.name}
          subtitle={role.isBuiltIn ? 'Built-in role' : 'Custom role'}
          badge={role.isBuiltIn ? <Badge variant="secondary">Built-in</Badge> : null}
          actions={
            <div className="flex items-center gap-2">
              <form action={duplicateRole}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="outline">
                  Duplicate
                </Button>
              </form>
              {!role.isBuiltIn ? (
                <form action={deleteRole}>
                  <input type="hidden" name="id" value={id} />
                  <ConfirmButton
                    type="submit"
                    variant="destructive"
                    confirmMessage={`Delete the role "${role.name}"? This can't be undone.`}
                  >
                    Delete
                  </ConfirmButton>
                </form>
              ) : null}
            </div>
          }
        />

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <form action={updateRole} className="space-y-5">
          <input type="hidden" name="id" value={id} />
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">
                    Name<span className="text-red-600"> *</span>
                  </Label>
                  <Input id="name" name="name" required defaultValue={role.name} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="key">Key</Label>
                  <Input id="key" value={role.key} disabled />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Identifier used in code — can&apos;t be changed.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={2}
                  defaultValue={role.description ?? ''}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Permissions</CardTitle>
            </CardHeader>
            <CardContent>
              <PermissionMatrix defaultSelected={role.permissions} />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit">Save role</Button>
          </div>
        </form>

        <Card>
          <CardHeader>
            <CardTitle>Members with this role ({members.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No members hold this role yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => (
                  <Link
                    key={m.membershipId}
                    href={`/admin/users/${m.membershipId}` as any}
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/60"
                  >
                    {m.displayName ?? m.name}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
