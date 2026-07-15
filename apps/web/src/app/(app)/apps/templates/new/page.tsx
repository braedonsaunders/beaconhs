import { getGeneratedTranslations } from '@/i18n/generated.server'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
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
import { assertCan } from '@beaconhs/tenant'
import { formTemplates, formTemplateVersions } from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/db/schema'
import { CANONICAL_TEMPLATES, getCanonicalTemplate } from '@beaconhs/db/canonical-templates'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'
import { eq } from 'drizzle-orm'
import { AppTypePicker } from './_app-type-picker'
import { formCategoryLabel } from '../../_lib/category-label'
import { slugify } from '../../_lib/slug'
import { generatedTemplateKey } from '../../_lib/template-key.server'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a050bcb668962') }
}

const CANONICAL_ICONS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  jsha_v1: HardHat,
  toolbox_v1: MessageSquare,
  wah_rescue_v1: CheckCircle2,
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
    return generatedTemplateKey(base)
  })
}

async function createTemplate(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.template.create')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const customKey = String(formData.get('key') ?? '').trim() || null
  if (!name) return
  // Custom keys invite stable slugs like "toolbox-talk", which may already
  // exist in the tenant (form_templates has a unique (tenant_id, key) index) —
  // run every candidate through the collision-safe picker. An all-symbols input
  // slugifies to '' and falls back to the name (then a generic base).
  const base = (customKey ? slugify(customKey) : '') || slugify(name) || 'app'
  const key = customKey ? await pickAvailableKey(ctx, base) : generatedTemplateKey(base)

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
  revalidatePath('/apps')
  redirect(`/apps/templates/${templateId}/designer`)
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
  assertCan(ctx, 'forms.template.create')
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
  revalidatePath('/apps')
  redirect(`/apps/templates/${templateId}/designer`)
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
        className="group block w-full rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-500 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700 group-hover:bg-teal-100 dark:bg-teal-950/50 dark:text-teal-300 dark:group-hover:bg-teal-900/50">
            <Icon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedValue value={name} />
              </h3>
              <ArrowRight
                size={16}
                className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-700"
              />
            </div>
            <p className="mt-1 line-clamp-3 text-xs text-slate-600 dark:text-slate-400">
              <GeneratedValue value={description} />
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">
                <GeneratedValue value={formCategoryLabel(category)} />
              </Badge>
              <Badge variant="outline">
                <GeneratedValue value={sectionCount} /> <GeneratedText id="m_02f67a0e8ba5ce" />
                <GeneratedValue
                  value={sectionCount === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
                />
              </Badge>
              <Badge variant="outline">
                <GeneratedValue value={fieldCount} /> <GeneratedText id="m_1d6aa8702d3fac" />
                <GeneratedValue
                  value={fieldCount === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
                />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-8">
        <PageHeader
          title={tGenerated('m_1a050bcb668962')}
          description={tGenerated('m_03ab06b42f789e')}
          back={{ href: '/apps', label: 'Back to Builder' }}
        />

        {/* App-type picker (primary) */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedText id="m_032194ff2b3504" />
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              <GeneratedText id="m_0996a8f51ca267" />
            </p>
          </div>
          <AppTypePicker />
        </section>

        {/* Start-from-canonical gallery */}
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedText id="m_057d952e47b935" />
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                <GeneratedText id="m_0af747ddf9578d" />
              </p>
            </div>
            <Badge variant="secondary">
              <GeneratedValue value={CANONICAL_TEMPLATES.length} />{' '}
              <GeneratedText id="m_097d1eaad6fbc4" />
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <GeneratedValue
              value={CANONICAL_TEMPLATES.map((c) => (
                <CanonicalCard
                  key={c.key}
                  canonicalKey={c.key}
                  name={c.name}
                  description={tGeneratedValue(c.description)}
                  sectionCount={c.schema.sections.length}
                  fieldCount={countFields(c.key)}
                  category={c.category}
                />
              ))}
            />
          </div>
        </section>

        {/* Blank-form fallback (secondary) */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedText id="m_068aaa150aa4bb" />
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              <GeneratedText id="m_08b4fa7fae76cb" />
            </p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedText id="m_16e8eec88287bd" />
              </CardTitle>
              <CardDescription>
                <GeneratedText id="m_167887992204cb" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createTemplate} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="name">
                    <GeneratedText id="m_1a9978900838e6" />
                  </Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    placeholder={tGenerated('m_0258a2c065a9ce')}
                  />
                  <p className="text-xs text-slate-500">
                    <GeneratedText id="m_1deb339cc3e627" />
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="key">
                    <GeneratedText id="m_12d4a2a912f384" />
                  </Label>
                  <Input id="key" name="key" placeholder={tGenerated('m_17cc2d73812072')} />
                  <p className="text-xs text-slate-500">
                    <GeneratedText id="m_179fc4c123d1c4" />
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="description">
                    <GeneratedText id="m_14d923495cf14c" />
                  </Label>
                  <Textarea
                    id="description"
                    name="description"
                    rows={3}
                    placeholder={tGenerated('m_074251897a5932')}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                  <Link href="/apps">
                    <Button type="button" variant="outline">
                      <GeneratedText id="m_112e2e8ecda428" />
                    </Button>
                  </Link>
                  <Button type="submit">
                    <GeneratedText id="m_05e241cea42acb" />
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>
    </PageContainer>
  )
}
