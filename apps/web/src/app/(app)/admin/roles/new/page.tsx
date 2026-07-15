import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import {
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
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { PermissionMatrix } from '../_components/permission-matrix'
import { createRole } from '../_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_166bee8f545e03') }
}
export const dynamic = 'force-dynamic'

export default async function NewRolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.roles.manage')) redirect('/admin')
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin/roles', label: 'Back to roles' }}
          title={tGenerated('m_166bee8f545e03')}
          subtitle={tGenerated('m_13f71dfe9115c3')}
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

        <form action={createRole} className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedText id="m_1560d4e2a09d09" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  <GeneratedText id="m_02b18d5c7f6f2d" />
                  <span className="text-red-600"> *</span>
                </Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder={tGenerated('m_1499afe8179427')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">
                  <GeneratedText id="m_14d923495cf14c" />
                </Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={2}
                  placeholder={tGenerated('m_13cfb63c1d1038')}
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
              <PermissionMatrix />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit">
              <GeneratedText id="m_005d107102f364" />
            </Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
