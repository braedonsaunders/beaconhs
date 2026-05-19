import Link from 'next/link'
import { asc } from 'drizzle-orm'
import {
  Button,
  Card,
  CardContent,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { personDivisions } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { createDivision } from '../../_actions/divisions'

export const metadata = { title: 'New division' }
export const dynamic = 'force-dynamic'

export default async function NewDivisionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const parentId = typeof sp.parent === 'string' ? sp.parent : null
  const ctx = await requireRequestContext()
  const parents = await ctx.db((tx) =>
    tx.select().from(personDivisions).orderBy(asc(personDivisions.name)),
  )

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-5">
        <DetailHeader
          back={{ href: '/people/divisions', label: 'Back to divisions' }}
          title="New division"
          subtitle="Divisions can nest indefinitely. Leave parent blank to create a top-level node."
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createDivision} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    placeholder="e.g. Mechanical"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="code">Short code</Label>
                  <Input id="code" name="code" placeholder="e.g. MECH" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="parentDivisionId">Parent division</Label>
                  <Select
                    id="parentDivisionId"
                    name="parentDivisionId"
                    defaultValue={parentId ?? ''}
                  >
                    <option value="">— Top-level —</option>
                    {parents.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" name="description" rows={3} />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <Link href="/people/divisions">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit">Create division</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
