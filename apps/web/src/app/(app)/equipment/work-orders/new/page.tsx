import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
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
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { RemoteSelectField } from '@/components/remote-search-select'
import { createEquipmentWorkOrder } from '../_lib'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_028792f1fdc70a') }
}
export const dynamic = 'force-dynamic'

const PRIORITIES = ['low', 'med', 'high'] as const

async function createWorkOrder(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.workorder.create')
  const itemId = String(formData.get('itemId') ?? '').trim()
  const summary = String(formData.get('summary') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const priority = String(formData.get('priority') ?? 'med') as (typeof PRIORITIES)[number]
  const assignedToTenantUserId = String(formData.get('assignedToTenantUserId') ?? '').trim() || null
  const reportedByPersonId = String(formData.get('reportedByPersonId') ?? '').trim() || null
  if (!itemId || !summary) throw new Error('Equipment and summary are required.')
  if (!PRIORITIES.includes(priority)) throw new Error('Invalid priority.')

  const row = await createEquipmentWorkOrder(ctx, {
    itemId,
    summary,
    description,
    priority,
    assignedToTenantUserId,
    reportedByPersonId,
  })
  if (!row) redirect('/equipment/work-orders')
  redirect(`/equipment/work-orders/${row.id}`)
}

export default async function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const presetItemId = pickString(sp.itemId) ?? ''
  // If we already know the equipment item, prefer the drawer on the parent
  // detail page. The full-page route stays around as a fallback when there
  // is no item context (e.g. linked from the work-orders list).
  if (presetItemId) {
    redirect(`/equipment/${presetItemId}?tab=work_orders&drawer=new-work-order`)
  }
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.workorder.create')

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/equipment/work-orders', label: 'Back to work orders' }}
          title={tGenerated('m_028792f1fdc70a')}
          subtitle={tGenerated('m_1c0bf1438ae054')}
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createWorkOrder} className="space-y-4">
              <Field label={tGenerated('m_17f17df74f7e69')} required>
                <RemoteSelectField
                  name="itemId"
                  defaultValue={presetItemId}
                  lookup="equipment-work-order-items"
                  placeholder={tGenerated('m_115f6cd16bb283')}
                  searchPlaceholder={tGenerated('m_11ab9c63ae3cae')}
                  sheetTitle="Select equipment"
                  clearable={false}
                />
              </Field>
              <Field label={tGenerated('m_031c356c80b70f')} required>
                <Input
                  name="summary"
                  required
                  maxLength={500}
                  placeholder={tGenerated('m_0da3b82e035598')}
                />
              </Field>
              <Field label={tGenerated('m_14d923495cf14c')}>
                <Textarea
                  name="description"
                  rows={4}
                  maxLength={10000}
                  placeholder={tGenerated('m_05f9cf03eb63e5')}
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={tGenerated('m_00f0e2904a371c')} required>
                  <Select name="priority" defaultValue="med">
                    <option value="low">{'Low'}</option>
                    <option value="med">{'Medium'}</option>
                    <option value="high">{'High'}</option>
                  </Select>
                </Field>
                <Field label={tGenerated('m_0b44d2ea8f2b0f')}>
                  <RemoteSelectField
                    name="assignedToTenantUserId"
                    defaultValue=""
                    lookup="equipment-work-order-assignees"
                    placeholder={tGenerated('m_00fa515d7be44e')}
                    searchPlaceholder={tGenerated('m_1f0bd3ac120c16')}
                    sheetTitle="Assign to"
                    emptyLabel={tGenerated('m_10d1d0d92a9aaa')}
                  />
                </Field>
                <Field label={tGenerated('m_036d83ad48ca7a')} className="sm:col-span-2">
                  <RemoteSelectField
                    name="reportedByPersonId"
                    defaultValue=""
                    lookup="equipment-work-order-reporters"
                    placeholder={tGenerated('m_0be39d3a196b5b')}
                    searchPlaceholder={tGenerated('m_06c2338b990aea')}
                    sheetTitle="Reported by"
                    clearable
                    emptyLabel={tGenerated('m_16c1eee898d62b')}
                  />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <Link href="/equipment/work-orders">
                  <Button type="button" variant="outline">
                    <GeneratedText id="m_112e2e8ecda428" />
                  </Button>
                </Link>
                <Button type="submit">
                  <GeneratedText id="m_1d6cea08bfa39b" />
                </Button>
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
        <GeneratedValue value={label} />
        <GeneratedValue value={required ? <span className="text-red-600"> *</span> : null} />
      </Label>
      <GeneratedValue value={children} />
    </div>
  )
}
