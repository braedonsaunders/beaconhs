import { redirect } from 'next/navigation'
import { asc } from 'drizzle-orm'
import { Button, Card, CardContent, DetailHeader, Input, Label, Select } from '@beaconhs/ui'
import { roles } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { ScopePicker } from '../_components/scope-picker'
import { loadScopeOptions } from '../_scope-data'
import { inviteUser } from '../_actions'

export const metadata = { title: 'Invite user' }
export const dynamic = 'force-dynamic'

export default async function InviteUserPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.users.manage')) redirect('/admin')
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined

  const allRoles = await ctx.db((tx) =>
    tx.select({ id: roles.id, name: roles.name }).from(roles).orderBy(asc(roles.name)),
  )
  const scopeOptions = await loadScopeOptions(ctx)

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-5">
        <DetailHeader
          back={{ href: '/admin/users', label: 'Back to users' }}
          title="Invite user"
          subtitle="Add someone to this tenant and email them a sign-in link."
        />

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <Card>
          <CardContent className="pt-6">
            <form action={inviteUser} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="email">
                    Email<span className="text-red-600"> *</span>
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder="name@company.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" placeholder="Optional" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="roleId">Initial role</Label>
                <Select id="roleId" name="roleId" defaultValue="">
                  <option value="">— No role yet —</option>
                  {allRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  You can assign roles and fine-tune permissions after they&apos;re added.
                </p>
              </div>

              <ScopePicker
                sites={scopeOptions.sites}
                crews={scopeOptions.crews}
                departments={scopeOptions.departments}
                groups={scopeOptions.groups}
                people={scopeOptions.people}
              />

              <div className="flex justify-end gap-2">
                <Button type="submit">Send invite</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
