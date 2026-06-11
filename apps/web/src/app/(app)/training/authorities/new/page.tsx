import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { trainingSkillAuthorities } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule, requireModuleManage } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New skill authority' }

async function createAuthority(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const code = String(formData.get('code') ?? '').trim() || null
  const jurisdiction = String(formData.get('jurisdiction') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(trainingSkillAuthorities)
      .values({ tenantId: ctx.tenantId, name, code, jurisdiction, notes })
      .returning()
    return r
  })
  if (row) {
    await recordAudit(ctx, {
      entityType: 'training_skill_authority',
      entityId: row.id,
      action: 'create',
      summary: `Created authority "${name}"`,
      after: { name, code, jurisdiction },
    })
  }
  revalidatePath('/training/authorities')
  if (row) redirect(`/training/authorities/${row.id}?tab=skill_types`)
  redirect('/training/authorities')
}

export default async function NewTrainingAuthorityPage() {
  await requireModuleManage('training')
  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/training/authorities', label: 'Back to authorities' }}
          title="New skill authority"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createAuthority} className="space-y-4">
              <Field label="Name" required>
                <Input name="name" required placeholder="e.g. Boilermakers Local 128" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Code">
                  <Input name="code" placeholder="e.g. BM128" />
                </Field>
                <Field label="Jurisdiction">
                  <Input name="jurisdiction" placeholder="e.g. Ontario / Federal / Internal" />
                </Field>
              </div>
              <Field label="Notes">
                <Textarea name="notes" rows={3} />
              </Field>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Create authority</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
