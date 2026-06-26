import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Button, Input, Label, PageHeader, Select, Textarea } from '@beaconhs/ui'
import { db, withSuperAdmin } from '@beaconhs/db'
import { auditLog, tenants } from '@beaconhs/db/schema'
import { seedLiftPlanTemplate } from '@beaconhs/db/seed/lift-plan-template'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New tenant' }

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

async function createTenant(formData: FormData): Promise<void> {
  'use server'
  // A server action is a POST endpoint — the /platform layout's super-admin
  // redirect protects the page render, NOT this action. Re-check here, or any
  // authenticated tenant member could create tenants (this bypasses RLS below).
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin) throw new Error('Only platform super-admins can create tenants.')
  const userId = ctx.userId

  const name = String(formData.get('name') ?? '').trim()
  const customSlug = String(formData.get('slug') ?? '').trim() || null
  const region = String(formData.get('region') ?? 'ca-central-1').trim()
  const defaultLanguage = String(formData.get('defaultLanguage') ?? 'en').trim()
  const enabledLanguagesRaw = String(formData.get('enabledLanguages') ?? 'en').trim()
  if (!name) return

  const slug = customSlug ? slugify(customSlug) : slugify(name)
  const enabledLanguages = enabledLanguagesRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  await withSuperAdmin(db, async (tx) => {
    const [created] = await tx
      .insert(tenants)
      .values({
        name,
        slug,
        status: 'active',
        region,
        defaultLanguage,
        enabledLanguages: enabledLanguages.length > 0 ? enabledLanguages : [defaultLanguage],
      })
      .returning({ id: tenants.id })
    if (created) {
      // Audit row lives in the *new* tenant's audit_log so the activity timeline
      // shows "tenant created" on day-one. Super-admin actions otherwise have
      // no natural home in any tenant's log.
      await tx.insert(auditLog).values({
        tenantId: created.id,
        actorUserId: userId,
        entityType: 'tenant',
        entityId: created.id,
        action: 'create',
        summary: `Created tenant "${name}" (${slug})`,
        after: { name, slug, region, defaultLanguage, enabledLanguages },
      })
      // Seed every built-in form template that's required on day-one. Done
      // inside the same transaction so a seeder failure rolls back the
      // tenant create — we never want a half-provisioned tenant.
      await seedLiftPlanTemplate(tx, created.id)
    }
  })

  revalidatePath('/platform/tenants')
  redirect('/platform/tenants')
}

export default function NewTenantPage() {
  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <div>
          <Link href="/platform/tenants" className="text-xs text-slate-500 hover:text-teal-700">
            ← Back to tenants
          </Link>
          <PageHeader
            title="New tenant"
            description="Super-admin only. Creates an empty tenant. Add an admin user from the Users page afterwards."
          />
        </div>
        <form
          action={createTenant}
          className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-white p-6"
        >
          <div className="space-y-1.5">
            <Label htmlFor="name">Tenant name *</Label>
            <Input id="name" name="name" required placeholder="e.g. Acme Industrial" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug (optional)</Label>
            <Input id="slug" name="slug" placeholder="auto-generated from name if blank" />
            <p className="text-xs text-slate-500">
              Used in URLs and as a stable identifier. Lowercase, numbers, dashes only.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="region">Region</Label>
              <Select id="region" name="region" defaultValue="ca-central-1">
                <option value="ca-central-1">Canada (Central)</option>
                <option value="us-east-1">US East</option>
                <option value="eu-west-1">EU West</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="defaultLanguage">Default language</Label>
              <Select id="defaultLanguage" name="defaultLanguage" defaultValue="en">
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="enabledLanguages">Enabled languages</Label>
            <Input id="enabledLanguages" name="enabledLanguages" defaultValue="en" />
            <p className="text-xs text-slate-500">
              Comma-separated ISO codes, e.g. <code>en,fr</code>
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href="/platform/tenants">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit">Create tenant</Button>
          </div>
        </form>
      </div>
    </PageContainer>
  )
}
