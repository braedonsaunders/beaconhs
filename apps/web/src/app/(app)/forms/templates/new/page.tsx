import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import {
  Button,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { formTemplates, formTemplateVersions } from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New form template' }

const CATEGORIES = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'jsha', label: 'JSHA / Job hazard analysis' },
  { value: 'toolbox_talk', label: 'Toolbox talk' },
  { value: 'incident_investigation', label: 'Incident investigation' },
  { value: 'audit', label: 'Audit / observation' },
  { value: 'checklist', label: 'Generic checklist' },
  { value: 'custom', label: 'Custom' },
]

const MODULE_BINDINGS = [
  { value: '', label: '— None (generic form) —' },
  { value: 'inspections', label: 'Inspections module' },
  { value: 'jsha', label: 'JSHAs module' },
  { value: 'toolbox_talk', label: 'Toolbox talks module' },
  { value: 'incident_investigation', label: 'Incident investigation' },
  { value: 'equipment_inspection', label: 'Equipment inspections' },
  { value: 'ppe_inspection', label: 'PPE inspections' },
]

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

async function createTemplate(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const category = String(formData.get('category') ?? '').trim() || null
  const moduleBinding = String(formData.get('moduleBinding') ?? '').trim() || null
  const customKey = String(formData.get('key') ?? '').trim() || null
  if (!name) return
  const key = customKey ? slugify(customKey) : `${slugify(name)}_${Math.random().toString(36).slice(2, 6)}`

  const initialSchema: FormSchemaV1 = {
    schemaVersion: 1,
    title: { en: name },
    description: description ? { en: description } : undefined,
    sections: [
      {
        id: 'sec_intro',
        title: { en: 'Section 1' },
        fields: [
          {
            id: 'field_notes',
            type: 'long_text',
            label: { en: 'Notes' },
            required: false,
          },
        ],
      },
    ],
    workflow: { steps: [{ key: 'submit', label: { en: 'Submit' } }] },
  }

  const templateId = await ctx.db(async (tx) => {
    const [tmpl] = await tx
      .insert(formTemplates)
      .values({
        tenantId: ctx.tenantId,
        key,
        name,
        category: category as any,
        description,
        moduleBinding,
        status: 'draft',
        createdBy: ctx.userId,
      })
      .returning({ id: formTemplates.id })
    if (!tmpl) throw new Error('Failed to insert form template')
    await tx.insert(formTemplateVersions).values({
      tenantId: ctx.tenantId,
      templateId: tmpl.id,
      version: 1,
      schema: initialSchema,
    })
    return tmpl.id
  })

  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: templateId,
    action: 'create',
    summary: `Created template "${name}"`,
    after: { name, key, category, moduleBinding },
  })
  revalidatePath('/forms')
  redirect(`/forms/templates/${templateId}/designer`)
}

export default function NewTemplatePage() {
  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="New form template"
          description="Create the template shell. You'll land in the visual designer where you add sections, fields, and conditional logic. Publish to v1 when you're ready."
          back={{ href: '/forms', label: 'Back to forms' }}
        />
        <form action={createTemplate} className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" name="name" required placeholder="e.g. Daily site walk inspection" />
            <p className="text-xs text-slate-500">Shown in lists, on PDFs, and as the form heading.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select id="category" name="category" defaultValue="inspection">
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="moduleBinding">Module binding</Label>
              <Select id="moduleBinding" name="moduleBinding" defaultValue="">
                {MODULE_BINDINGS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-slate-500">
                Hides the template from the generic /forms list when bound to a specialty module.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="key">Key (optional)</Label>
            <Input id="key" name="key" placeholder="auto-generated from name if blank" />
            <p className="text-xs text-slate-500">
              Stable slug that survives across versions. Lowercase letters, numbers, _, -.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              placeholder="What's this template for? Who fills it out?"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href="/forms">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Create + open designer</Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
