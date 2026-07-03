import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
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
} from '@beaconhs/ui'
import { apiKeys } from '@beaconhs/db/schema'
import { PageContainer } from '@/components/page-layout'
import { PERMISSION_GROUPS } from '@/lib/permissions-meta'
import { PermissionMatrix } from '../../roles/_components/permission-matrix'
import { revokeApiKey, updateApiKey } from '../_actions'
import { requireApiKeyAdmin } from '../_guard'

export const metadata = { title: 'API key' }
export const dynamic = 'force-dynamic'

function dateInputValue(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : ''
}

function PermissionList({ permissions }: { permissions: string[] }) {
  const selected = new Set(permissions)
  const groups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    permissions: group.permissions.filter((permission) => selected.has(permission.key)),
  })).filter((group) => group.permissions.length > 0)

  if (groups.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No permissions.</p>
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
            {group.label}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.permissions.map((permission) => (
              <span
                key={permission.key}
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                title={permission.key}
              >
                {permission.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default async function ApiKeyEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireApiKeyAdmin()
  const { id } = await params
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined

  const key = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1)
    return row ?? null
  })
  if (!key) notFound()

  const expired = !key.revokedAt && key.expiresAt && key.expiresAt.getTime() <= Date.now()

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin/api-keys', label: 'Back to API keys' }}
          title={key.name}
          subtitle={`${key.prefix}...`}
          badge={
            key.revokedAt ? (
              <Badge variant="destructive">Revoked</Badge>
            ) : expired ? (
              <Badge variant="outline">Expired</Badge>
            ) : (
              <Badge variant="success">Active</Badge>
            )
          }
          actions={
            !key.revokedAt ? (
              <form action={revokeApiKey}>
                <input type="hidden" name="id" value={key.id} />
                <Button type="submit" variant="outline">
                  Revoke
                </Button>
              </form>
            ) : null
          }
        />

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {key.revokedAt ? (
          <Card>
            <CardHeader>
              <CardTitle>Permissions</CardTitle>
            </CardHeader>
            <CardContent>
              <PermissionList permissions={key.permissions ?? []} />
            </CardContent>
          </Card>
        ) : (
          <form action={updateApiKey} className="space-y-5">
            <input type="hidden" name="id" value={key.id} />
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
                    <Input id="name" name="name" required defaultValue={key.name} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expiresAt">Expires</Label>
                    <Input
                      id="expiresAt"
                      type="date"
                      name="expiresAt"
                      defaultValue={dateInputValue(key.expiresAt)}
                    />
                  </div>
                </div>
                <div className="grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                      Prefix
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-700 dark:text-slate-200">
                      {key.prefix}...
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                      Created
                    </div>
                    <div className="mt-1 text-slate-700 dark:text-slate-200">
                      {new Date(key.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                      Last used
                    </div>
                    <div className="mt-1 text-slate-700 dark:text-slate-200">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Permissions</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Remount after each save: React auto-resets a `<form action>`
                    on success, unchecking the controlled checkboxes in the DOM
                    without re-rendering them, so the next save would post a
                    stale selection. `updatedAt` bumps per save (`$onUpdate`). */}
                <PermissionMatrix
                  key={key.updatedAt.toISOString()}
                  defaultSelected={key.permissions ?? []}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit">Save key</Button>
            </div>
          </form>
        )}
      </div>
    </PageContainer>
  )
}
