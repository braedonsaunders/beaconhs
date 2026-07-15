import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { notFound } from 'next/navigation'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
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
import { apiKeys, formTemplates } from '@beaconhs/db/schema'
import { PageContainer } from '@/components/page-layout'
import { formatDateTime } from '@/lib/datetime'
import { isUuid } from '@/lib/list-params'
import { PERMISSION_GROUPS } from '@/lib/permissions-meta'
import { PermissionMatrix } from '../../roles/_components/permission-matrix'
import { revokeApiKey, updateApiKey } from '../_actions'
import { requireApiKeyAdmin } from '../_guard'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_04689ff1b29440') }
}
export const dynamic = 'force-dynamic'

function dateInputValue(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : ''
}

function PermissionList({ permissions }: { permissions: string[] }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const selected = new Set(permissions)
  const groups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    permissions: group.permissions.filter((permission) => selected.has(permission.key)),
  })).filter((group) => group.permissions.length > 0)

  if (groups.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_013b3870672127" />
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <GeneratedValue
        value={groups.map((group) => (
          <div key={group.key}>
            <div className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              <GeneratedValue value={group.label} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <GeneratedValue
                value={group.permissions.map((permission) => (
                  <span
                    key={permission.key}
                    className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    title={tGeneratedValue(permission.key)}
                  >
                    <GeneratedValue value={permission.label} />
                  </span>
                ))}
              />
            </div>
          </div>
        ))}
      />
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireApiKeyAdmin()
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined

  const [key, builderApps] = await Promise.all([
    ctx.db(async (tx) => {
      const [row] = await tx
        .select({
          apiKey: apiKeys,
          expired: sql<boolean>`${apiKeys.expiresAt} IS NOT NULL AND ${apiKeys.expiresAt} <= now()`,
        })
        .from(apiKeys)
        .where(eq(apiKeys.id, id))
        .limit(1)
      return row ?? null
    }),
    ctx.db((tx) =>
      tx
        .select({ id: formTemplates.id, name: formTemplates.name })
        .from(formTemplates)
        .where(and(eq(formTemplates.status, 'published'), isNull(formTemplates.deletedAt)))
        .orderBy(asc(formTemplates.name)),
    ),
  ])
  if (!key) notFound()

  const { apiKey, expired } = key

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin/api-keys', label: 'Back to API keys' }}
          title={tGeneratedValue(apiKey.name)}
          subtitle={tGeneratedValue(`${apiKey.prefix}...`)}
          badge={
            apiKey.revokedAt ? (
              <Badge variant="destructive">
                <GeneratedText id="m_1ae9fac75309ce" />
              </Badge>
            ) : expired ? (
              <Badge variant="outline">
                <GeneratedText id="m_13f7150c94b182" />
              </Badge>
            ) : (
              <Badge variant="success">
                <GeneratedText id="m_1e1b1fdb7dd78e" />
              </Badge>
            )
          }
          actions={
            !apiKey.revokedAt ? (
              <form action={revokeApiKey}>
                <input type="hidden" name="id" value={apiKey.id} />
                <Button type="submit" variant="outline">
                  <GeneratedText id="m_18718dd379a57d" />
                </Button>
              </form>
            ) : null
          }
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

        <GeneratedValue
          value={
            apiKey.revokedAt ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_0f16ebbc2ed672" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PermissionList permissions={apiKey.permissions ?? []} />
                </CardContent>
              </Card>
            ) : (
              <form action={updateApiKey} className="space-y-5">
                <input type="hidden" name="id" value={apiKey.id} />
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <GeneratedText id="m_1560d4e2a09d09" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="name">
                          <GeneratedText id="m_02b18d5c7f6f2d" />
                          <span className="text-red-600"> *</span>
                        </Label>
                        <Input id="name" name="name" required defaultValue={apiKey.name} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="expiresAt">
                          <GeneratedText id="m_14f3858b0a9ad6" />
                        </Label>
                        <Input
                          id="expiresAt"
                          type="date"
                          name="expiresAt"
                          defaultValue={dateInputValue(apiKey.expiresAt)}
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 text-sm sm:grid-cols-3">
                      <div>
                        <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                          <GeneratedText id="m_00adfbfb276db4" />
                        </div>
                        <div className="mt-1 font-mono text-xs text-slate-700 dark:text-slate-200">
                          <GeneratedValue value={apiKey.prefix} />
                          ...
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                          <GeneratedText id="m_10cbe051fb5e05" />
                        </div>
                        <div className="mt-1 text-slate-700 dark:text-slate-200">
                          <GeneratedValue
                            value={formatDateTime(
                              new Date(apiKey.createdAt),
                              ctx.timezone,
                              ctx.locale,
                            )}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                          <GeneratedText id="m_0d0ec4c8965d4c" />
                        </div>
                        <div className="mt-1 text-slate-700 dark:text-slate-200">
                          <GeneratedValue
                            value={
                              apiKey.lastUsedAt ? (
                                formatDateTime(
                                  new Date(apiKey.lastUsedAt),
                                  ctx.timezone,
                                  ctx.locale,
                                )
                              ) : (
                                <GeneratedText id="m_1ab6ba88ce908e" />
                              )
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>
                      <GeneratedText id="m_161e4f441da198" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_1869534f88f258" />
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <GeneratedValue
                        value={builderApps.map((app) => (
                          <label key={app.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="builderTemplateIds"
                              value={app.id}
                              defaultChecked={(apiKey.builderTemplateIds ?? []).includes(app.id)}
                            />
                            <span>
                              <GeneratedValue value={app.name} />
                            </span>
                          </label>
                        ))}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>
                      <GeneratedText id="m_0f16ebbc2ed672" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {/* Remount after each save: React auto-resets a `<form action>`
                    on success, unchecking the controlled checkboxes in the DOM
                    without re-rendering them, so the next save would post a
                    stale selection. `updatedAt` bumps per save (`$onUpdate`). */}
                    <PermissionMatrix
                      key={apiKey.updatedAt.toISOString()}
                      defaultSelected={apiKey.permissions ?? []}
                    />
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button type="submit">
                    <GeneratedText id="m_1fce3d2032c5d6" />
                  </Button>
                </div>
              </form>
            )
          }
        />
      </div>
    </PageContainer>
  )
}
