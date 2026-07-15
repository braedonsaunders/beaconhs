import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_05b8de370e95a9') }
}
export const dynamic = 'force-dynamic'

export default async function InviteUserPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
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
          title={tGenerated('m_05b8de370e95a9')}
          subtitle={tGenerated('m_08e15739a25560')}
        />

        <GeneratedValue
          value={
            error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                <GeneratedValue value={error} />
              </div>
            ) : null
          }
        />

        <Card>
          <CardContent className="pt-6">
            <form action={inviteUser} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="email">
                    <GeneratedText id="m_00a0ba9938bdff" />
                    <span className="text-red-600"> *</span>
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder={tGenerated('m_010dd70c0d4e7b')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="name">
                    <GeneratedText id="m_02b18d5c7f6f2d" />
                  </Label>
                  <Input id="name" name="name" placeholder={tGenerated('m_0cadbe8ae1ae4e')} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="roleId">
                  <GeneratedText id="m_12e16ef485d96c" />
                </Label>
                <Select id="roleId" name="roleId" defaultValue="">
                  <option value="">
                    <GeneratedText id="m_0bb62460374184" />
                  </option>
                  <GeneratedValue
                    value={allRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        <GeneratedValue value={r.name} />
                      </option>
                    ))}
                  />
                </Select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_1024d17dea25f7" />
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
                <Button type="submit">
                  <GeneratedText id="m_132972a45d7b08" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
