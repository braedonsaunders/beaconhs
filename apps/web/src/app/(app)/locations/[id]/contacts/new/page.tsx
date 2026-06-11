import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { customerContacts, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export const metadata = { title: 'New contact' }
export const dynamic = 'force-dynamic'

async function createContact(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const orgUnitId = String(formData.get('orgUnitId') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  const role = String(formData.get('role') ?? '').trim() || null
  const email = String(formData.get('email') ?? '').trim() || null
  const phone = String(formData.get('phone') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  const isPrimary = formData.get('isPrimary') === 'on'
  if (!orgUnitId || !name) throw new Error('Name and location are required')

  const [row] = await ctx.db((tx) =>
    tx
      .insert(customerContacts)
      .values({ tenantId: ctx.tenantId, orgUnitId, name, role, email, phone, notes, isPrimary })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'customer_contact',
      entityId: row.id,
      action: 'create',
      summary: `Added contact "${name}"`,
      after: { name, role, email, phone, isPrimary, orgUnitId },
    })
  }
  revalidatePath(`/locations/${orgUnitId}`)
  redirect(`/locations/${orgUnitId}?tab=contacts`)
}

export default async function NewContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const unit = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return u
  })
  if (!unit) notFound()

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <DetailHeader
        back={{ href: `/locations/${id}?tab=contacts`, label: `Back to ${unit.name}` }}
        title="Add contact"
        subtitle={`At ${unit.name}`}
      />
      <Card>
        <CardContent className="pt-6">
          <form action={createContact} className="space-y-4">
            <input type="hidden" name="orgUnitId" value={id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" required>
                <Input name="name" required autoFocus />
              </Field>
              <Field label="Role">
                <Input name="role" placeholder="e.g. Site Manager" />
              </Field>
              <Field label="Email">
                <Input name="email" type="email" autoComplete="email" />
              </Field>
              <Field label="Phone">
                <Input name="phone" type="tel" autoComplete="tel" />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <Textarea name="notes" rows={3} />
              </Field>
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="contact-is-primary"
                  type="checkbox"
                  name="isPrimary"
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <Label htmlFor="contact-is-primary" className="text-sm">
                  Mark as primary contact
                </Label>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit">Create contact</Button>
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
