import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import {
  Button,
  Card,
  CardContent,
  DetailHeader,
  Input,
  Label,
} from '@beaconhs/ui'
import { orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export const metadata = { title: 'New project' }
export const dynamic = 'force-dynamic'

async function createProject(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const parentId = String(formData.get('parentId') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim() || null
  if (!parentId || !name) throw new Error('Parent customer and name are required')

  // Verify the parent is a customer (or at least exists & is owned by this tenant).
  const parent = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(orgUnits).where(eq(orgUnits.id, parentId)).limit(1)
    return p
  })
  if (!parent) throw new Error('Parent customer not found')

  const [row] = await ctx.db((tx) =>
    tx
      .insert(orgUnits)
      .values({
        tenantId: ctx.tenantId,
        parentId,
        level: 'project',
        name,
        code,
      })
      .returning(),
  )

  if (row) {
    await recordAudit(ctx, {
      entityType: 'org_unit',
      entityId: row.id,
      action: 'create',
      summary: `Added project "${name}" under ${parent.name}`,
      after: { name, code, level: 'project', parentId },
    })
  }

  revalidatePath('/locations')
  revalidatePath(`/locations/${parentId}`)
  if (row) redirect(`/locations/${row.id}`)
  redirect(`/locations/${parentId}?tab=projects`)
}

export default async function NewProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const customer = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return u
  })
  if (!customer) notFound()

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <DetailHeader
        back={{ href: `/locations/${id}?tab=projects`, label: `Back to ${customer.name}` }}
        title="Add project"
        subtitle={`Under ${customer.name}`}
      />
      <Card>
        <CardContent className="pt-6">
          <form action={createProject} className="space-y-4">
            <input type="hidden" name="parentId" value={id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Project name" required className="sm:col-span-2">
                <Input name="name" required autoFocus />
              </Field>
              <Field label="Project code">
                <Input name="code" placeholder="e.g. TA-2026" />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="submit">Create project</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
