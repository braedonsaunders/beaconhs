import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, HardHat, MessageSquare, Sparkles } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageHeader,
  Textarea,
} from '@beaconhs/ui'
import { formTemplates, formTemplateVersions } from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/db/schema'
import { CANONICAL_TEMPLATES, getCanonicalTemplate } from '@beaconhs/db/canonical-templates'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'
import { eq } from 'drizzle-orm'
import { AppTypePicker } from './_app-type-picker'

export const metadata = { title: 'New app' }

const CANONICAL_ICONS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  jsha_v1: HardHat,
  toolbox_v1: MessageSquare,
  wah_rescue_v1: CheckCircle2,
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

async function pickAvailableKey(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  base: string,
): Promise<string> {
  // Try the base key first; if it's taken in this tenant, suffix with -2, -3…
  return ctx.db(async (tx) => {
    let candidate = base
    let attempt = 1
    // Bounded loop — give up after 50 tries and fall back to a random suffix.
    while (attempt <= 50) {
      const existing = await tx
        .select({ id: formTemplates.id })
        .from(formTemplates)
        .where(eq(formTemplates.key, candidate))
        .limit(1)
      if (existing.length === 0) return candidate
      attempt += 1
      candidate = `${base}_${attempt}`
    }
    return `${base}_${Math.random().toString(36).slice(2, 8)}`
  })
}

async function createTemplate(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const customKey = String(formData.get('key') ?? '').trim() || null
  if (!name) return
  const key = customKey
    ? slugify(customKey)
    : `${slugify(name)}_${Math.random().toString(36).slice(2, 6)}`

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
    workflow: {
      steps: [
        {
          key: 'submit',
          title: { en: 'Submit' },
          assignee: { type: 'expression', expr: '$submitter' },
        },
      ],
    },
  }

  const templateId = await ctx.db(async (tx) => {
    const [tmpl] = await tx
      .insert(formTemplates)
      .values({
        tenantId: ctx.tenantId,
        key,
        name,
        description,
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
    after: { name, key, mode: 'blank' },
  })
  revalidatePath('/forms')
  redirect(`/forms/templates/${templateId}/designer`)
}

/**
 * Clone one of the four canonical templates (JSHA / Toolbox / Lift Plan / WAH Rescue)
 * into the user's tenant. The schema is identical to the canonical; the key gets a
 * tenant-local suffix so multiple clones can co-exist and so we don't collide with
 * a prior install of the same canonical for that tenant.
 */
async function createFromCanonical(formData: FormData): Promise<void> {
  'use server'
  const canonicalKey = String(formData.get('canonicalKey') ?? '').trim()
  if (!canonicalKey) return
  const canonical = getCanonicalTemplate(canonicalKey)
  if (!canonical) return

  const ctx = await requireRequestContext()
  // Use the canonical key as the base; suffix on collision so admins can clone
  // multiple variations of the same canonical (e.g. site-specific tweaks).
  const key = await pickAvailableKey(ctx, canonical.key)

  const templateId = await ctx.db(async (tx) => {
    const [tmpl] = await tx
      .insert(formTemplates)
      .values({
        tenantId: ctx.tenantId,
        key,
        name: canonical.name,
        category: canonical.category,
        description: canonical.description,
        moduleBinding: canonical.moduleBinding,
        status: 'draft',
        createdBy: ctx.userId,
      })
      .returning({ id: formTemplates.id })
    if (!tmpl) throw new Error('Failed to insert form template')
    await tx.insert(formTemplateVersions).values({
      tenantId: ctx.tenantId,
      templateId: tmpl.id,
      version: 1,
      schema: canonical.schema,
      changelog: `Cloned from canonical "${canonical.key}"`,
    })
    return tmpl.id
  })

  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: templateId,
    action: 'create',
    summary: `Cloned canonical template "${canonical.name}"`,
    after: {
      name: canonical.name,
      key,
      category: canonical.category,
      moduleBinding: canonical.moduleBinding,
      canonicalKey: canonical.key,
      mode: 'canonical',
    },
  })
  revalidatePath('/forms')
  redirect(`/forms/templates/${templateId}/designer`)
}

function CanonicalCard({
  canonicalKey,
  name,
  description,
  sectionCount,
  fieldCount,
  category,
}: {
  canonicalKey: string
  name: string
  description: string
  sectionCount: number
  fieldCount: number
  category: string
}) {
  const Icon = CANONICAL_ICONS[canonicalKey] ?? Sparkles
  return (
    <form action={createFromCanonical}>
      <input type="hidden" name="canonicalKey" value={canonicalKey} />
      <button
        type="submit"
        className="group block w-full rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-500 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700 group-hover:bg-teal-100">
            <Icon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-base font-semibold text-slate-900">{name}</h3>
              <ArrowRight
                size={16}
                className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-700"
              />
            </div>
            <p className="mt-1 line-clamp-3 text-xs text-slate-600">{description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{category}</Badge>
              <Badge variant="outline">
                {sectionCount} section{sectionCount === 1 ? '' : 's'}
              </Badge>
              <Badge variant="outline">
                {fieldCount} field{fieldCount === 1 ? '' : 's'}
              </Badge>
            </div>
          </div>
        </div>
      </button>
    </form>
  )
}

function countFields(canonicalKey: string): number {
  const c = getCanonicalTemplate(canonicalKey)
  if (!c) return 0
  return c.schema.sections.reduce((n, s) => n + s.fields.length, 0)
}

export default function NewTemplatePage() {
  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-8">
        <PageHeader
          title="New app"
          description="Select an app type to open the designer pre-configured for it, clone a canonical template, or build from scratch."
          back={{ href: '/forms', label: 'Back to Builder' }}
        />

        {/* App-type picker (primary) */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Choose an app type</h2>
            <p className="text-sm text-slate-600">
              Form, multi-step Wizard, Checklist, tabular Register, or a composed Mini-app.
            </p>
          </div>
          <AppTypePicker />
        </section>

        {/* Start-from-canonical gallery */}
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Start from a template</h2>
              <p className="text-sm text-slate-600">
                The four big modules from the legacy app — now shipped as form templates. Pick one
                and tweak.
              </p>
            </div>
            <Badge variant="secondary">{CANONICAL_TEMPLATES.length} canonical templates</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CANONICAL_TEMPLATES.map((c) => (
              <CanonicalCard
                key={c.key}
                canonicalKey={c.key}
                name={c.name}
                description={c.description}
                sectionCount={c.schema.sections.length}
                fieldCount={countFields(c.key)}
                category={c.category}
              />
            ))}
          </div>
        </section>

        {/* Blank-form fallback (secondary) */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Or build from scratch</h2>
            <p className="text-sm text-slate-600">
              Create an empty template and add sections, fields, and conditional logic in the
              designer.
            </p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Blank template</CardTitle>
              <CardDescription>
                You'll land in the visual designer with one empty section. Publish to v1 when ready.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createTemplate} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    placeholder="e.g. Daily site walk inspection"
                  />
                  <p className="text-xs text-slate-500">
                    Shown in lists, on PDFs, and as the form heading.
                  </p>
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
                    placeholder="Purpose and audience"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                  <Link href="/forms">
                    <Button type="button" variant="outline">
                      Cancel
                    </Button>
                  </Link>
                  <Button type="submit">Create blank + open designer</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>
    </PageContainer>
  )
}
