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

export const metadata = { title: 'New role' }
export const dynamic = 'force-dynamic'

export default async function NewRolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.roles.manage')) redirect('/admin')
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : undefined

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin/roles', label: 'Back to roles' }}
          title="New role"
          subtitle="Name the role and choose what it can do."
        />

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <form action={createRole} className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  Name<span className="text-red-600"> *</span>
                </Label>
                <Input id="name" name="name" required placeholder="e.g. Site Coordinator" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={2}
                  placeholder="What this role is for"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Permissions</CardTitle>
            </CardHeader>
            <CardContent>
              <PermissionMatrix />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit">Create role</Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
