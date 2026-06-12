import { redirect } from 'next/navigation'
import { asc, eq, isNull } from 'drizzle-orm'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { hazidHazardTypes, hazidHazards } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { createTaskLibrary } from '../../_actions'
import { MultiPicker } from '../../_multipicker'
import { RiskMatrixField } from '../../_risk'

export const metadata = { title: 'New task' }
export const dynamic = 'force-dynamic'

async function submit(formData: FormData) {
  'use server'
  await createTaskLibrary(formData)
  redirect('/hazard-assessments/tasks')
}

export default async function NewTaskPage() {
  const ctx = await requireRequestContext()
  const hazards = await ctx.db((tx) =>
    tx
      .select({ id: hazidHazards.id, name: hazidHazards.name, typeName: hazidHazardTypes.name })
      .from(hazidHazards)
      .leftJoin(hazidHazardTypes, eq(hazidHazardTypes.id, hazidHazards.hazardTypeId))
      .where(isNull(hazidHazards.deletedAt))
      .orderBy(asc(hazidHazards.name)),
  )
  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/hazard-assessments/tasks', label: 'Back' }}
          title="New task"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input name="name" required placeholder="e.g. Open / break flanges on live line" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea name="description" rows={3} />
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                <RiskMatrixField
                  label="Inherent risk (before controls)"
                  likelihoodName="preLikelihood"
                  severityName="preSeverity"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Default controls</Label>
                <Textarea name="controls" rows={3} placeholder="LOTO, double-block & bleed, PPE…" />
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                <RiskMatrixField
                  label="Residual risk (with controls in place)"
                  likelihoodName="postLikelihood"
                  severityName="postSeverity"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Linked hazards</Label>
                <MultiPicker
                  name="hazardIds"
                  options={hazards.map((h) => ({
                    value: h.id,
                    label: h.name,
                    sublabel: h.typeName ?? undefined,
                  }))}
                />
              </div>
              <div className="flex items-center justify-end">
                <Button type="submit">Create task</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
